import crypto from 'crypto';
import isPlainObject from 'lodash/isPlainObject';
import isString from 'lodash/isString';
import isFunction from 'lodash/isFunction';
import isUndefined from 'lodash/isUndefined';
import isInteger from 'lodash/isInteger';
import inRange from 'lodash/inRange';
import omitBy from 'lodash/omitBy';
import typeOf from 'typeof';
import amqp from 'amqplib';
import uuid from 'uuid';

class MessageBus {

  /**
   * Constructs new message bus with the supplied properties.
   * @param {Object} spec message bus properties
   * @property {string} spec.url AMQP server URL
   * @constructor
   */
  constructor(spec) {
    if (!isPlainObject(spec)) throw new TypeError(`Invalid "spec" param; expected plain object, received ${typeOf(spec)}`);

    const { url, queue, encryptionKey } = spec;
    if (!isString(url)) throw new TypeError(`Invalid "url" property; expected string, received ${typeOf(url)}`);
    if (!isString(queue)) throw new TypeError(`Invalid "queue" property; expected string, received ${typeOf(queue)}`);
    if (!(isString(encryptionKey) || isUndefined(encryptionKey))) throw new TypeError(`Invalid "encryptionKey" property; expected string, received ${typeOf(encryptionKey)}`);

    this.url = url;
    this.queue = queue;
    this.encryptionKey = encryptionKey;
    this.conn = null;
    this.publisherChannel = null;
    this.subscriberChannel = null;
    this.consumerTag = null;
  }

  /**
   * Encrypts the supplied JSON object and returns a new buffer.
   * @param {Object} obj
   * @returns {Buffer}
   */
  encrypt(json) {
    if (this.encryptionKey === undefined) {
      return Buffer.from(JSON.stringify(json), 'utf8');
    }

    const cipher = crypto.createCipher('aes128', this.encryptionKey);
    const buf1 = cipher.update(JSON.stringify(json), 'utf8');
    const buf2 = cipher.final();
    return Buffer.concat([buf1, buf2], buf1.length + buf2.length);
  }

  /**
   * Decrypts the supplied buffer and returns a JSON object.
   * @param {Buffer} buf
   * @returns {Object}
   */
  decrypt(buf) {
    if (this.encryptionKey === undefined) {
      return JSON.parse(buf.toString('utf8'));
    }

    const decipher = crypto.createDecipher('aes128', this.encryptionKey);
    const str = [
      decipher.update(buf, 'utf8'),
      decipher.final('utf8')
    ].join('');

    return JSON.parse(str);
  }

  /**
   * Connects to AMQP server.
   * @returns {Promise}
   */
  async connect() {
    // check if already connected
    if (this.conn !== null) {
      return; // exit
    }

    this.conn = await amqp.connect(this.url);
    this.subscriberChannel = await this.conn.createChannel();
    this.publisherChannel = await this.conn.createConfirmChannel();
    await this.subscriberChannel.assertQueue(this.queue, {
      durable: true,
      maxPriority: 10
    });
    await this.subscriberChannel.prefetch(1);
  }

  /**
   * Disconnects from AMQP server.
   * @returns {Promise}
   */
  async disconnect() {
    // check if already disconnected
    if (this.conn === null) {
      return; // exit
    }

    // cancel subscription if active
    if (this.consumerTag !== null) {
      await this.subscriberChannel.cancel(this.consumerTag);
      this.consumerTag = null;
    }

    await this.conn.close();

    this.conn = null;
    this.subscriberChannel = null;
    this.publisherChannel = null;
  }

  /**
   * Subscribes to the message bus for incoming messages.
   * @param {Function<Object, Object, Function>} listener a function with (msg, props, done) arguments
   * @returns {Promise<Function>} resolving to an unsubscribe method
   * @see {@link http://www.squaremobius.net/amqp.node/channel_api.html#channel_assertQueue} for further info on option properties.
   */
  async subscribe(listener) {
    if (!isFunction(listener)) throw new TypeError(`Invalid "callback" param; expected function, received ${typeOf(listener)}`);

    if (this.subscriberChannel === null) {
      throw new Error('Cannot subscribe to message bus; did you forget to call #connect()');
    }

    if (this.consumerTag) {
      throw new Error('Subscription already active; cannot open multiple subscriptions to the same message bus');
    }

    try {
      // create unique consumer tag
      this.consumerTag = uuid.v4();

      // subscribe to channel
      await this.subscriberChannel.consume(this.queue, (msg) => {
        const done = (err) => {
          if (err) {
            this.subscriberChannel.nack(msg);
          } else {
            this.subscriberChannel.ack(msg);
          }
        };

        const content = this.decrypt(msg.content);
        const props = omitBy(msg.properties, isUndefined);

        listener(content, props, done);
      }, {
        consumerTag: this.consumerTag,
        noAck: false // explicitely ack messages when done
      });

      // return unsubscribe() method
      return async () => {
        await this.subscriberChannel.cancel(this.consumerTag);
        this.consumerTag = null;
      };
    } catch (err) {
      this.consumerTag = null;
      throw err;
    }
  }

  /**
   * Published the supplied message to the given queue.
   * @param {*} content can be any JSON serializable value, incl. Object and Array.
   * @param {Object} [props]
   * @property {number} [props.priority=1] message priority must be between 1 and 10.
   * @property {string} [props.type]
   * @property {string} [props.messageId=uuid.v4()]
   * @property {number} [props.timestamp=Date.now()]
   * @returns {Promise<boolean>}
   */
  async publish(content, props = {}) {
    if (isUndefined(content)) throw new TypeError('Invalid "content" param; must be specified');
    if (!isPlainObject(props)) throw new TypeError(`Invalid "props" param; expected plain object, received ${typeOf(props)}`);

    const {
      type,
      priority = 1,
      messageId = uuid.v4(),
      timestamp = Date.now()
    } = props;

    if (!isInteger(priority)) throw new TypeError(`Invalid "priority" property; expected integer, received ${typeOf(priority)}`);
    if (!inRange(priority, 1, 11)) throw new TypeError('Invalid "priority" property; must be between 1 and 10');
    if (!isString(messageId)) throw new TypeError(`Invalid "messageId" property; expected string, received ${typeOf(messageId)}`);
    if (!(isString(type) || isUndefined(type))) throw new TypeError(`Invalid "type" property; expected string, received ${typeOf(type)}`);
    if (!isInteger(timestamp)) throw new TypeError(`Invalid "timestamp" property; expected integer, received ${typeOf(timestamp)}`);

    // make sure publisher channel is open
    if (this.publisherChannel === null) {
      throw new Error('Cannot publish to message bus; did you forget to call #connect()');
    }

    this.publisherChannel.sendToQueue(
      this.queue,
      this.encrypt(content),
      { messageId, type, priority, timestamp }
    );

    return this.publisherChannel.waitForConfirms();
  }
}

export default MessageBus;
