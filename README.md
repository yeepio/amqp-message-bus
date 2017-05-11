# AMQP Message Bus

Node.js message bus interface for AMQP servers, such as RabbitMQ.

[![Build Status](https://travis-ci.org/jmike/naomi.svg?branch=master)](https://travis-ci.org/jmike/naomi) [![npm version](https://badge.fury.io/js/naomi.svg)](https://badge.fury.io/js/naomi)

#### Features

* Message bus API hides the complexity of AMQP connectors;
* Supports symmetric message encryption;
* Works pefectly fine with async/await.

## Installation

```
$ npm install amqp-message-bus
```

#### Requirements

* Node.js v.4+

## Quick start

Install `amqp-message-bus` from npm.

```
$ npm install amqp-message-bus --save
```

Create new message bus.

```javascript
const MessageBus = require('amqp-message-bus');

const bus = new MessageBus({
  queue: 'tasks',
  url: 'amqp://localhost',
  encryptionKey: 'keep-it-safe'
});
```

Connect to AMQP server and subscribe for messages.

```javascript
bus.connect()
  .then(() => bus.subscribe((msg, props, done) => {
    // process msg + props
    console.log(`Received message ${props.messageId} with priority ${props.priority}, published on ${props.timestamp}`);
    // call done when message is done processing to remove from rabbitmq
    done();
  }))
  // call this when you want to unsubscribe...
  .then((unsubscribe) => unsubscribe())
  // always catch errors with promises :-)
  .catch((err) => console.error(err));
```

The same looks much better using async/await.

```javascript
await bus.connect();

const unsubscribe = await bus.subscribe((msg, props, done) => {
  // process msg + props
  console.log(`Received message ${props.messageId} with priority ${props.priority}, published on ${props.timestamp}`);
  // call done when ready to remove message from rabbitmq
  done();
});

// call this when you want to unsubscribe...
await unsubscribe();
```

Connect to AMQP server, publish message and immediately disconnect.

```javascript
bus.connect()
  .then(() => bus.publish({ foo: 1, bar: 2 }))
  .catch((err) => console.error(err))
  .finally(() => bus.disconnect);
```

## API Docs

### <a name="constructor" href="constructor">#</a>constructor(spec) -> MessageBus

Constructs new message bus with the supplied properties.

##### Arguments

1. `spec` _(Object)_ message bus properties (required).
    * `spec.url` _(string)_ AMQP server URL (required).
    * `spec.queue` _(string)_ the name of the queue to subscribe to (required).
    * `spec.encryptionKey` _(string)_ encryption key to use with assymetric encryption (optional). Signifies no encryption if left unspecified.

##### Example

```javascript
const bus = new MessageBus({
  queue: 'tasks',
  url: 'amqp://localhost',
  encryptionKey: 'keep-it-safe'
});
```

### <a name="connect" href="connect">#</a>connect() -> Promise

Connects to AMQP server using the connection properties specified at construction time.

##### Returns

Returns a native Promise.

##### Example

```javascript
bus.connect()
  .then(() => {
    console.log('Connected to amqp server');
  })
  .catch((err) => {
    console.error(err);
  });
```

### <a name="disconnect" href="disconnect">#</a>disconnect() -> Promise

Disconnects from AMQP server.

##### Returns

Returns a native Promise.

##### Example

```javascript
bus.disconnect()
  .then(() => {
    console.log('Disconnected from amqp server');
  })
  .catch((err) => {
    console.error(err);
  });
```

### <a name="subscribe" href="subscribe">#</a>subscribe(listener) -> Promise\<Function\>

Subscribes to the message bus for incoming messages.

##### Arguments

1. `listener` _(Function\<Object, Object, Function\>)_ listener function (required).

###### Listener function arguments

1. `msg` _(Object)_ message body (required).
2. `props` _(Object)_ message meta-data (required).
3. `done` _(Function)_ call done to signal message proccessing is done (required).

Please visit [http://www.squaremobius.net/amqp.node/channel_api.html#channel_assertQueue](http://www.squaremobius.net/amqp.node/channel_api.html#channel_assertQueue) for further info on `props` meta-data.

##### Returns

Returns a native Promise resolving to an `unsubscribe()` method.

##### Example

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
    unsubscribe();
  })
  .catch((err) => {
    console.error(err);
  });
```

##### Example using async/await

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

### <a name="publish" href="publish">#</a>publish(msg, props) -> Promise\<boolean\>

Publishes the supplied message to the AMQP server.

##### Arguments

1. `content` _(*)_ message body (required); can be any JSON serializable value, e.g. Object, Array.
2. `props` _(Object)_ message props (optional).
    * `props.id` _(string)_ message ID (optional; defaults to `UUID v4`)
    * `props.priority` _(integer)_ message priority, must be between 1 and 10 (optional; defaults to 1)
    * `props.timestamp` _(number)_ message timestamp (optional; defaults to `Date.now()`)
    * `props.type` _(string)_ message type (optional)

##### Returns

Returns a native Promise resolving to a boolean value.

##### Example

```javascript
bus.publish({ foo: 'bar' }, { type: 'nonsense', priority: 10 })
  .catch((err) => {
    console.error(err);
  });
```

##### Example using async/await

```javascript
await bus.publish({ foo: 'bar' }, { type: 'nonsense', priority: 10 });
```

## Contribute

Source code contributions are most welcome. The following rules apply:

1. Follow the [Airbnb Style Guide](https://github.com/airbnb/javascript);
2. Make sure not to break the tests.

## License

[MIT](LICENSE)
