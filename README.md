# AMQP Message Bus

Node.js message bus interface for AMQP servers, such as RabbitMQ.

[![Build Status](https://travis-ci.org/yeepio/amqp-message-bus.svg?branch=master)](https://travis-ci.org/yeepio/amqp-message-bus) [![npm version](https://badge.fury.io/js/amqp-message-bus.svg)](https://badge.fury.io/js/amqp-message-bus)

#### Features

* Hides the complexity of AMQP client;
* Comes with build-in symmetric message encryption;
* Supports promises + async/await.

## Installation

```
$ npm install amqp-message-bus
```

#### Requirements

* Node.js v.7+

## Quick start

Create new message bus.

```javascript
const MessageBus = require('amqp-message-bus');

const bus = new MessageBus({
  url: 'amqp://localhost',
  encryptionKey: 'keep-it-safe'
});
```

Connect to AMQP server and subscribe to queue for messages.

```javascript
await bus.connect();

const unsubscribe = await bus.subscribe('my_queue', (msg, props, done) => {
  // process msg + props
  console.log(`Received message ${props.messageId} with priority ${props.priority}, published on ${props.timestamp}`);
  // call done when ready to remove message from rabbitmq
  done();
});

// unsubscribe from queue
await unsubscribe();

// disconnect from bus
await bus.disconnect();
```

Connect to AMQP server, create queue (if not exists) and send message.

```javascript
await bus.connect();
await bus.assertQueue('my_queue');
await bus.sendToQueue('my_queue', { foo: 1, bar: 2 });
await bus.disconnect();
```

Connect to AMQP server, create topic exchange and publish message to route.

```javascript
await bus.connect();
await bus.assertExchange('my_exchange', 'topic'); // note the 2nd argument (i.e. "topic") used to create a topic exchange
await bus.assertQueue('my_queue');
await bus.bindQueue('my_queue', 'my_exchange', 'route.1'); // note the 3rd argument (i.e. route.1)
await bus.publish('my_exchange', 'route.1', { foo: 1, bar: 2 }); // note the 3rd argument (i.e. route.1)
await bus.disconnect();
```

## API Docs

### <a name="constructor" href="constructor">#</a>constructor(spec) -> MessageBus

Constructs new message bus with the supplied properties.

#### Arguments

- **props** _(Object)_ message bus properties (required).
- **props.url** _(string)_ AMQP server URL (required).
- **props.encryptionKey** _(string)_ encryption key to use with symmetric encryption (optional).

#### Example

```javascript
const bus = new MessageBus({
  url: 'amqp://localhost',
  encryptionKey: 'keep-it-safe'
});
```

### <a name="connect" href="connect">#</a>connect() -> Promise

Connects to AMQP server.

#### Returns

`Promise`

#### Example

```javascript
bus.connect()
  .then(() => {
    console.log('Connected to rabbitmq');
  })
  .catch((err) => {
    console.error(err);
  });
```

### <a name="disconnect" href="disconnect">#</a>disconnect() -> Promise

Disconnects from AMQP server.

#### Returns

`Promise`

#### Example

```javascript
bus.disconnect()
  .then(() => {
    console.log('Disconnected from rabbitmq');
  })
  .catch((err) => {
    console.error(err);
  });
```

### <a name="subscribe" href="subscribe">#</a>subscribe(queue, listener)

Subscribes to the designated queue for incoming messages.

#### Arguments

- **queue** _(string)_ the name of the queue to subscribe to
- **listener** _(Function)_ listener function, i.e. `function(msg, props, done)` (required).
    - **msg** _(Object)_ message body (required).
    - **props** _(Object)_ message meta-data (required).
    - **done** _(Function)_ call done to signal message proccessing is done (required).

Please visit [http://www.squaremobius.net/amqp.node/channel_api.html#channel_assertQueue](http://www.squaremobius.net/amqp.node/channel_api.html#channel_assertQueue) for further info on `props` meta-data.

#### Returns

`Promise<Function>`

The function returned is the `unsubscribe()` method.

#### Example

```javascript
const listener = (msg, props, done) => {
  // do something with msg and props
  console.log(JSON.stringify(msg, null, 2));
  // call done when you are done with msg to remove from queue
  done();
};

bus.subscribe(listener)
  .then((unsubscribe) => {
    // unsubscribe when ready
    return unsubscribe();
  })
  .catch((err) => {
    console.error(err);
  });
```

#### Example using async/await

```javascript
const unsubscribe = await bus.subscribe((msg, props, done) => {
  // do something with msg and props
  console.log(JSON.stringify(msg, null, 2));
  // call done when you are done with msg to remove from queue
  done();
});

// unsubscribe when ready
await unsubscribe();
```

### <a name="sendToQueue" href="sendToQueue">#</a>sendToQueue(queue, message, props)

Sends the supplied message to the designated queue.

#### Arguments

- **queue** _(string)_ the name of the queue to send message to (required)
- **message** _(*)_ message body; can be any JSON serializable value (required)
- **props** _(Object)_ message props (optional).
- **props.id** _(string)_ message ID (optional; defaults to `UUID v4`)
- **props.priority** _(integer)_ message priority, must be between 1 and 10 (optional; defaults to 1)
- **props.timestamp** _(number)_ message timestamp (optional; defaults to `Date.now()`)
- **props.type** _(string)_ message type (optional)

#### Returns

`Promise`

#### Example

```javascript
bus.sendToQueue('my_queue', {
  foo: 'bar'
}, {
  type: 'nonsense',
  priority: 10
})
  .catch((err) => {
    console.error(err);
  });
```

#### Example using async/await

```javascript
await bus.sendToQueue({
  foo: 'bar'
}, {
  type: 'nonsense',
  priority: 10
});
```

### <a name="publish" href="publish">#</a>publish(exchange, routingKey, message, props)

Publishes the supplied message to the designated exchange.

#### Arguments

- **exchange** _(string)_ the name of the exchange to publish message to (required)
- **routingKey** _(string)_ the routing key to publish message to (required)
- **message** _(*)_ message body; can be any JSON serializable value (required)
- **props** _(Object)_ message props (optional).
- **props.id** _(string)_ message ID (optional; defaults to `UUID v4`)
- **props.priority** _(integer)_ message priority, must be between 1 and 10 (optional; defaults to 1)
- **props.timestamp** _(number)_ message timestamp (optional; defaults to `Date.now()`)
- **props.type** _(string)_ message type (optional)

#### Returns

`Promise`

#### Example

```javascript
bus.publish('my_exchange', 'route.1', {
  foo: 'bar'
}, {
  type: 'nonsense',
  priority: 10
})
  .catch((err) => {
    console.error(err);
  });
```

#### Example using async/await

```javascript
await bus.publish('my_exchange', 'route.1', {
  foo: 'bar'
}, {
  type: 'nonsense',
  priority: 10
});
```

### <a name="unsubscribe" href="unsubscribe">#</a>unsubscribe(consumerTag)

Unsubscribes the designated consumer.

#### Arguments

- **consumerTag** _(string)_ the ID of the consumer to unsubscribe from queue (required)

#### Returns

`Promise`

#### Example

```javascript
bus.unsubscribe('consumer-123')
  .catch((err) => {
    console.error(err);
  });
```

### <a name="unsubscribeAll" href="unsubscribeAll">#</a>unsubscribeAll()

Unsubscribes all message bus consumers.

#### Returns

`Promise`

#### Example

```javascript
bus.unsubscribeAll()
  .catch((err) => {
    console.error(err);
  });
```

## Contribute

Source code contributions are most welcome. The following rules apply:

1. Follow the [Airbnb Style Guide](https://github.com/airbnb/javascript);
2. Make sure not to break the tests.

## License

[MIT](LICENSE)
