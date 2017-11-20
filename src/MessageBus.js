import crypto from 'crypto';
import Promise from 'bluebird';
import isPlainObject from 'lodash/isPlainObject';
import isString from 'lodash/isString';
import isFunction from 'lodash/isFunction';
import isNull from 'lodash/isNull';
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
   * @param {Object} props message bus properties
   * @property {string} props.url AMQP server URL
   * @property {string} [props.encryptionKey]
   * @constructor
   */
  constructor(props) {
    if (!isPlainObject(props)) {
      throw new TypeError(`Invalid props; expected plain object, received ${typeOf(props)}`);
    }

    const {
      url,
      encryptionKey = null
    } = props;

    if (!isString(url)) {
      throw new TypeError(`Invalid url property; expected string, received ${typeOf(url)}`);
    }
    if (!(isString(encryptionKey) || isNull(encryptionKey))) {
      throw new TypeError(`Invalid encryptionKey property; expected string, received ${typeOf(encryptionKey)}`);
    }

    this.url = url;
    this.encryptionKey = encryptionKey;
    this.consumers = new Map();
    this.conn = null;
    this.incomingChannel = null;
    this.outgoingChannel = null;
  }

  /**
   * Connects to AMQP server.
   * @returns {Promise}
   */
  async connect() {
    // make sure not already connected
    if (this.conn) {
      return; // exit
    }

    // create connection
    this.conn = await amqp.connect(this.url);
    this.conn.on('error', (err) => {
      console.error(err);
    });
    this.conn.on('close', () => {
      this.reconnect();
    });

    // create for incoming / outgoing messages
    this.incomingChannel = await this.conn.createChannel();
    this.outgoingChannel = await this.conn.createConfirmChannel();

    await this.incomingChannel.prefetch(1);
  }

  /**
   * Disconnects from AMQP server.
   * @returns {Promise}
   */
  async disconnect() {
    // make sure not disconnected
    if (!this.conn) {
      return; // exit
    }

    // unsubscribe any active consumer(s)
    await Promise.all(
      Array.from(this.consumers.keys()).map((consumerTag) => {
        return this.unsubscribe(consumerTag);
      })
    );

    // close connection
    this.conn.removeAllListeners();
    await this.conn.close();

    // reset local state
    this.conn = null;
    this.incomingChannel = null;
    this.outgoingChannel = null;
  }

  /**
   * Reconnects to AMQP server.
   * @returns {Promise}
   */
  async reconnect() {
    this.conn.removeAllListeners();
    this.conn = null; // you need this otherwise connect() will exit prematurily

    while (true) {
      await Promise.delay(1000);
      try {
        await this.connect();
        break; // exit loop
      } catch (err) {
        // do nothing
      }
    }
  }

  /**
   * Encrypts the supplied payload and returns a new buffer.
   * @param {string} encryptionKey
   * @returns {Buffer}
   */
  encrypt(payload) {
    if (this.encryptionKey == null) {
      return Buffer.from(JSON.stringify(payload), 'utf8');
    }

    const cipher = crypto.createCipher('aes128', this.encryptionKey);
    const buf1 = cipher.update(JSON.stringify(payload), 'utf8');
    const buf2 = cipher.final();
    return Buffer.concat([buf1, buf2], buf1.length + buf2.length);
  }

  /**
   * Decrypts the supplied buffer and returns its payload.
   * @param {Buffer} buf
   * @param {string} encryptionKey
   * @returns {Object}
   */
  decrypt(buf) {
    if (this.encryptionKey == null) {
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
   * Subscribes to the designated queue for messages.
   * @param {string} queue
   * @param {Function<Object, Object, Function>} listener i.e. function(msg, props, done) {}
   * @returns {Promise<Function>} resolving to an unsubscribe method
   */
  async subscribe(queue, listener) {
    if (!isString(queue)) {
      throw new TypeError(`Invalid queue; expected string, received ${typeOf(queue)}`);
    }
    if (!isFunction(listener)) {
      throw new TypeError(`Invalid listener; expected function, received ${typeOf(listener)}`);
    }

    if (!this.conn) {
      throw new Error('Cannot subscribe to queue; did you forget to call #connect()');
    }

    if (this.consumerTag) {
      throw new Error('Subscription already active; cannot open multiple subscriptions to the same message bus');
    }

    // create unique consumer tag
    const consumerTag = uuid.v4();

    try {
      // subscribe to channel
      await this.incomingChannel.consume(queue, (msg) => {
        listener(
          this.decrypt(msg.content),
          omitBy(msg.properties, isUndefined),
          (err) => this.incomingChannel[err ? 'nack' : 'ack'](msg)
        );
      }, {
        consumerTag,
        noAck: false // explicitely ack messages when done
      });

      // return unsubscribe() method
      return this.unsubscribe.bind(this, consumerTag);
    } finally {
      // add consumerTag to consumers registry
      this.consumers.set(consumerTag, queue);
    }
  }

  /**
   * Unsubscribes the designated consumer.
   * @param {string} consumerTag
   * @returns {Promise}
   */
  async unsubscribe(consumerTag) {
    if (!isString(consumerTag)) {
      throw new TypeError(`Invalid consumerTag; expected string, received ${typeOf(consumerTag)}`);
    }
    if (!this.consumers.has(consumerTag)) {
      throw new Error(`Unknown consumer tag ${consumerTag}`);
    }

    await this.incomingChannel.cancel(consumerTag);
    this.consumers.delete(consumerTag);
  }

  /**
   * Publishes the supplied message to the given exchange.
   * @param {string} exchange
   * @param {*} message can be any JSON serializable value, incl. Object and Array.
   * @param {Object} [props]
   * @property {number} [props.priority=1] message priority must be between 1 and 10.
   * @property {string} [props.type]
   * @property {string} [props.messageId=uuid.v4()]
   * @property {number} [props.timestamp=Date.now()]
   * @returns {Promise<boolean>}
   */
  async publish(exchange, routingKey, message, props = {}) {
    if (!isString(exchange)) {
      throw new TypeError(`Invalid exchange; expected string, received ${typeOf(exchange)}`);
    }
    if (!isString(routingKey)) {
      throw new TypeError(`Invalid routingKey; expected string, received ${typeOf(routingKey)}`);
    }
    if (isUndefined(message)) {
      throw new TypeError('Invalid message; must be specified');
    }
    if (!isPlainObject(props)) {
      throw new TypeError(`Invalid props; expected plain object, received ${typeOf(props)}`);
    }

    const {
      type,
      priority = 1,
      messageId = uuid.v4(),
      timestamp = Date.now()
    } = props;

    if (!isInteger(priority)) {
      throw new TypeError(`Invalid "priority" property; expected integer, received ${typeOf(priority)}`);
    }
    if (!inRange(priority, 1, 11)) {
      throw new TypeError('Invalid "priority" property; must be between 1 and 10');
    }
    if (!isString(messageId)) {
      throw new TypeError(`Invalid "messageId" property; expected string, received ${typeOf(messageId)}`);
    }
    if (!(isString(type) || isUndefined(type))) {
      throw new TypeError(`Invalid "type" property; expected string, received ${typeOf(type)}`);
    }
    if (!isInteger(timestamp)) {
      throw new TypeError(`Invalid "timestamp" property; expected integer, received ${typeOf(timestamp)}`);
    }

    // make sure connection is open
    if (!this.conn) {
      throw new Error('Cannot publish to exchange; did you forget to call #connect()');
    }

    return new Promise((resolve) => {
      this.outgoingChannel.publish(
        exchange,
        routingKey,
        this.encrypt(message),
        {
          messageId,
          type,
          priority,
          timestamp
        },
        () => resolve()
      );
    });
  }

  /**
   * Sends the supplied message to the given queue.
   * @param {string} queue
   * @param {*} message can be any JSON serializable value, incl. Object and Array.
   * @param {Object} [props]
   * @property {number} [props.priority=1] message priority must be between 1 and 10.
   * @property {string} [props.type]
   * @property {string} [props.messageId=uuid.v4()]
   * @property {number} [props.timestamp=Date.now()]
   * @returns {Promise<boolean>}
   */
  async sendToQueue(queue, message, props = {}) {
    if (!isString(queue)) {
      throw new TypeError(`Invalid queue; expected string, received ${typeOf(queue)}`);
    }
    if (isUndefined(message)) {
      throw new TypeError('Invalid message; must be specified');
    }
    if (!isPlainObject(props)) {
      throw new TypeError(`Invalid props; expected plain object, received ${typeOf(props)}`);
    }

    const {
      type,
      priority = 1,
      messageId = uuid.v4(),
      timestamp = Date.now()
    } = props;

    if (!isInteger(priority)) {
      throw new TypeError(`Invalid "priority" property; expected integer, received ${typeOf(priority)}`);
    }
    if (!inRange(priority, 1, 11)) {
      throw new TypeError('Invalid "priority" property; must be between 1 and 10');
    }
    if (!isString(messageId)) {
      throw new TypeError(`Invalid "messageId" property; expected string, received ${typeOf(messageId)}`);
    }
    if (!(isString(type) || isUndefined(type))) {
      throw new TypeError(`Invalid "type" property; expected string, received ${typeOf(type)}`);
    }
    if (!isInteger(timestamp)) {
      throw new TypeError(`Invalid "timestamp" property; expected integer, received ${typeOf(timestamp)}`);
    }

    // make sure connection is open
    if (!this.conn) {
      throw new Error('Cannot send to queue; did you forget to call #connect()');
    }

    return new Promise((resolve) => {
      this.outgoingChannel.sendToQueue(
        queue,
        this.encrypt(message),
        {
          messageId,
          type,
          priority,
          timestamp
        },
        () => resolve()
      );
    });
  }

  async assertExchange(exchange, type, options = {}) {
    if (!isString(exchange)) {
      throw new TypeError(`Invalid exchange; expected string, received ${typeOf(exchange)}`);
    }
    if (!isString(type)) {
      throw new TypeError(`Invalid type; expected string, received ${typeOf(type)}`);
    }
    if (!isPlainObject(options)) {
      throw new TypeError(`Invalid options; expected plain object, received ${typeOf(options)}`);
    }

    // make sure connection is open
    if (!this.conn) {
      throw new Error('Cannot assert exchange; did you forget to call #connect()');
    }

    return this.incomingChannel.assertExchange(exchange, type, options);
  }

  async assertQueue(queue, options = {}) {
    if (!isString(queue)) {
      throw new TypeError(`Invalid queue; expected string, received ${typeOf(queue)}`);
    }
    if (!isPlainObject(options)) {
      throw new TypeError(`Invalid options; expected plain object, received ${typeOf(options)}`);
    }

    // make sure connection is open
    if (!this.conn) {
      throw new Error('Cannot assert queue; did you forget to call #connect()');
    }

    return this.incomingChannel.assertQueue(queue, options);
  }

  async deleteQueue(queue, options = {}) {
    if (!isString(queue)) {
      throw new TypeError(`Invalid queue; expected string, received ${typeOf(queue)}`);
    }
    if (!isPlainObject(options)) {
      throw new TypeError(`Invalid options; expected plain object, received ${typeOf(options)}`);
    }

    // make sure connection is open
    if (!this.conn) {
      throw new Error('Cannot delete queue; did you forget to call #connect()');
    }

    // unsubscribe any queue consumer
    await Promise.all(
      Array.from(this.consumers)
        .filter(([key, value]) => value === queue)
        .map(([key]) => this.unsubscribe(key))
    );

    return this.incomingChannel.deleteQueue(queue, options);
  }

  async bindQueue(queue, source, pattern) {
    if (!isString(queue)) {
      throw new TypeError(`Invalid queue; expected string, received ${typeOf(queue)}`);
    }
    if (!isString(source)) {
      throw new TypeError(`Invalid source; expected string, received ${typeOf(source)}`);
    }
    if (!isString(pattern)) {
      throw new TypeError(`Invalid pattern; expected string, received ${typeOf(pattern)}`);
    }

    // make sure connection is open
    if (!this.conn) {
      throw new Error('Cannot assert queue; did you forget to call #connect()');
    }

    return this.incomingChannel.bindQueue(queue, source, pattern);
  }

  async unbindQueue(queue, source, pattern) {
    if (!isString(queue)) {
      throw new TypeError(`Invalid queue; expected string, received ${typeOf(queue)}`);
    }
    if (!isString(source)) {
      throw new TypeError(`Invalid source; expected string, received ${typeOf(source)}`);
    }
    if (!isString(pattern)) {
      throw new TypeError(`Invalid pattern; expected string, received ${typeOf(pattern)}`);
    }

    // make sure connection is open
    if (!this.conn) {
      throw new Error('Cannot assert queue; did you forget to call #connect()');
    }

    return this.incomingChannel.unbindQueue(queue, source, pattern);
  }

  // /**
  //  * Indicates whether the designated queue already exists.
  //  * @param {string} queue
  //  * @returns {Promise}
  //  */
  // async existsQueue(queue) {
  //   if (!isString(queue)) {
  //     throw new TypeError(`Invalid queue; expected string, received ${typeOf(queue)}`);
  //   }

  //   // make sure connection is open
  //   if (!this.conn) {
  //     throw new Error('Unable to check queue existence; did you forget to call #connect()');
  //   }

  //   try {
  //     const response = await this.incomingChannel.checkQueue(queue);
  //     return response.queue === queue;
  //   } catch (err) {
  //     return false; // TODO: Find out why this shit causes the connection to close
  //   }
  // }
}

export default MessageBus;
