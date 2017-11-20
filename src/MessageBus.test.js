/* eslint-env jest */

import Promise from 'bluebird';
import 'dotenv/config'; // load env variables
import MessageBus from './MessageBus';
import uuid from 'uuid';

describe('MessageBus', () => {
  describe('constructor()', () => {
    it('throws error when props is unspecified', () => {
      expect(() => new MessageBus())
        .toThrowError('Invalid props; expected plain object, received undefined');
    });

    it('throws error when props is invalid', () => {
      expect(() => new MessageBus(123))
        .toThrowError('Invalid props; expected plain object, received number');
      expect(() => new MessageBus('foo'))
        .toThrowError('Invalid props; expected plain object, received string');
      expect(() => new MessageBus(null))
        .toThrowError('Invalid props; expected plain object, received null');
      expect(() => new MessageBus(true))
        .toThrowError('Invalid props; expected plain object, received boolean');
      expect(() => new MessageBus([]))
        .toThrowError('Invalid props; expected plain object, received array');
    });

    it('throws error when url is unspecified', () => {
      expect(() => new MessageBus({}))
        .toThrowError('Invalid url property; expected string, received undefined');
    });

    it('throws error when encryptionKey is invalid', () => {
      expect(() => new MessageBus({ url: process.env.RABBITMQ_URL, queue: '__test__', encryptionKey: 123 }))
        .toThrowError('Invalid encryptionKey property; expected string, received number');
    });
  });

  const bus = new MessageBus({
    url: process.env.RABBITMQ_URL,
    encryptionKey: process.env.MESSAGE_BUS_encryptionKey
  });

  describe('connect()', () => {
    it('connects to AMQP server', async () => {
      expect(bus.conn).toBe(null);
      expect(bus.incomingChannel).toBe(null);
      expect(bus.outgoingChannel).toBe(null);
      expect(bus.consumers.size).toBe(0);
      await bus.connect();
      expect(bus.conn).not.toBe(null);
      expect(bus.incomingChannel).not.toBe(null);
      expect(bus.outgoingChannel).not.toBe(null);
      expect(bus.consumers.size).toBe(0);
    });

    it('does not throw if called twice', async () => {
      await bus.connect();
      expect(bus.conn).not.toBe(null);
    });
  });

  describe('disconnect()', () => {
    it('disconnects from AMQP server', async () => {
      await bus.disconnect();
      expect(bus.conn).toBe(null);
      expect(bus.conn).toBe(null);
      expect(bus.incomingChannel).toBe(null);
      expect(bus.outgoingChannel).toBe(null);
      expect(bus.consumers.size).toBe(0);
    });

    it('does not throw if called twice', async () => {
      await bus.disconnect();
      expect(bus.conn).toBe(null);
    });
  });

  describe('subscribe()', () => {
    it('throws error when queue is unspecified', async () => {
      try {
        await bus.subscribe();
      } catch (err) {
        expect(err.message).toBe('Invalid queue; expected string, received undefined');
      }
    });

    it('throws error when queue is invalid', async () => {
      try {
        await bus.subscribe(123);
      } catch (err) {
        expect(err.message).toBe('Invalid queue; expected string, received number');
      }

      try {
        await bus.subscribe(null);
      } catch (err) {
        expect(err.message).toBe('Invalid queue; expected string, received null');
      }

      try {
        await bus.subscribe(true);
      } catch (err) {
        expect(err.message).toBe('Invalid queue; expected string, received boolean');
      }

      try {
        await bus.subscribe({});
      } catch (err) {
        expect(err.message).toBe('Invalid queue; expected string, received object');
      }

      try {
        await bus.subscribe([]);
      } catch (err) {
        expect(err.message).toBe('Invalid queue; expected string, received array');
      }
    });

    describe('@disconnected', () => {
      it('throws error when disconnected', async () => {
        try {
          await bus.subscribe('queue', (msg, props, done) => done());
        } catch (err) {
          expect(err.message).toBe('Cannot subscribe to queue; did you forget to call #connect()');
        }
      });
    });

    describe('@connected', () => {
      const queue = uuid.v4();
      const message = {
        a: 1,
        foo: 'bar'
      };

      beforeAll(async () => {
        await bus.connect();
        await bus.assertQueue(queue);
      });
      afterAll(async () => {
        await bus.deleteQueue(queue);
        await bus.disconnect();
      });

      it('subscribes to messages', async () => {
        const listener = jest.fn((msg, props, done) => done());
        await bus.subscribe(queue, listener);
        await bus.sendToQueue(queue, message, {
          type: 'test'
        });

        await Promise.delay(100); // required for test case to work
        expect(listener).toHaveBeenCalled();
        expect(listener.mock.calls[0][0]).toEqual(message);
        expect(listener.mock.calls[0][1].type).toBe('test');
      });
    });

    // it('garbage collects consumers on disconnect()', async () => {
    //   expect(bus.consumers.size).toBe(0);
    // });
  });

  describe('sendToQueue()', () => {
    it('throws error when queue is unspecified', async () => {
      try {
        await bus.sendToQueue();
      } catch (err) {
        expect(err.message).toBe('Invalid queue; expected string, received undefined');
      }
    });

    it('throws error when message is unspecified', async () => {
      try {
        await bus.sendToQueue('queue');
      } catch (err) {
        expect(err.message).toBe('Invalid message; must be specified');
      }
    });

    it('throws error when props is invalid', async () => {
      try {
        await bus.sendToQueue('queue', 'foo', 123);
      } catch (err) {
        expect(err.message).toBe('Invalid props; expected plain object, received number');
      }

      try {
        await bus.sendToQueue('queue', 'foo', true);
      } catch (err) {
        expect(err.message).toBe('Invalid props; expected plain object, received boolean');
      }

      try {
        await bus.sendToQueue('queue', 'foo', 'abc');
      } catch (err) {
        expect(err.message).toBe('Invalid props; expected plain object, received string');
      }

      try {
        await bus.sendToQueue('queue', 'foo', []);
      } catch (err) {
        expect(err.message).toBe('Invalid props; expected plain object, received array');
      }

      try {
        await bus.sendToQueue('queue', 'foo', () => console.log(1));
      } catch (err) {
        expect(err.message).toBe('Invalid props; expected plain object, received function');
      }
    });

    describe('@disconnected', () => {
      it('throws error when disconnected', async () => {
        try {
          await bus.sendToQueue('queue', 123);
        } catch (err) {
          expect(err.message).toBe('Cannot send to queue; did you forget to call #connect()');
        }
      });
    });

    describe('@connected', () => {
      const queue = uuid.v4();
      const message = {
        a: 1,
        foo: 'bar'
      };

      beforeAll(async () => {
        await bus.connect();
        await bus.assertQueue(queue);
      });
      afterAll(async () => {
        await bus.deleteQueue(queue);
        await bus.disconnect();
      });

      it('sends message with custom properties', async () => {
        const listener = jest.fn((msg, props, done) => done());
        await bus.subscribe(queue, listener);
        const timestamp = Date.now();
        await bus.sendToQueue(queue, message, {
          timestamp,
          type: 'test'
        });

        await Promise.delay(100); // required for test case to work
        expect(listener).toHaveBeenCalled();
        expect(listener.mock.calls[0][0]).toEqual(message);
        expect(listener.mock.calls[0][1]).toMatchObject({
          timestamp,
          type: 'test'
        });
      });
    });
  });

  describe('publish()', () => {
    it('throws error when exchange is unspecified', async () => {
      try {
        await bus.publish();
      } catch (err) {
        expect(err.message).toBe('Invalid exchange; expected string, received undefined');
      }
    });

    it('throws error when routingKey is unspecified', async () => {
      try {
        await bus.publish('exchange');
      } catch (err) {
        expect(err.message).toBe('Invalid routingKey; expected string, received undefined');
      }
    });

    it('throws error when message is unspecified', async () => {
      try {
        await bus.publish('exchange', 'route.a');
      } catch (err) {
        expect(err.message).toBe('Invalid message; must be specified');
      }
    });

    it('throws error when props is invalid', async () => {
      try {
        await bus.publish('exchange', 'route.a', 'foo', 123);
      } catch (err) {
        expect(err.message).toBe('Invalid props; expected plain object, received number');
      }

      try {
        await bus.publish('exchange', 'route.a', 'foo', true);
      } catch (err) {
        expect(err.message).toBe('Invalid props; expected plain object, received boolean');
      }

      try {
        await bus.publish('exchange', 'route.a', 'foo', 'abc');
      } catch (err) {
        expect(err.message).toBe('Invalid props; expected plain object, received string');
      }

      try {
        await bus.publish('exchange', 'route.a', 'foo', []);
      } catch (err) {
        expect(err.message).toBe('Invalid props; expected plain object, received array');
      }

      try {
        await bus.publish('exchange', 'route.a', 'foo', () => console.log(1));
      } catch (err) {
        expect(err.message).toBe('Invalid props; expected plain object, received function');
      }
    });

    describe('@disconnected', () => {
      it('throws error when disconnected', async () => {
        try {
          await bus.publish('exchange', 'route.a', 123);
        } catch (err) {
          expect(err.message).toBe('Cannot publish to exchange; did you forget to call #connect()');
        }
      });
    });

    describe('@connected', () => {
      const queue = uuid.v4();
      const exchange = uuid.v4();
      const routingKey = 'route.1';
      const message = {
        a: 1,
        foo: 'bar'
      };

      beforeAll(async () => {
        await bus.connect();
        await bus.assertExchange(exchange, 'topic');
        await bus.assertQueue(queue);
        await bus.bindQueue(queue, exchange, routingKey);
      });
      afterAll(async () => {
        await bus.unbindQueue(queue, exchange, routingKey);
        await bus.deleteQueue(queue);
        await bus.disconnect();
      });

      it('publishes message with custom properties', async () => {
        const listener = jest.fn((msg, props, done) => done());
        await bus.subscribe(queue, listener);

        const timestamp = Date.now();
        await bus.publish(exchange, routingKey, message, {
          timestamp,
          type: 'test'
        });

        await Promise.delay(100); // required for test case to work
        expect(listener).toHaveBeenCalled();
        expect(listener.mock.calls[0][0]).toEqual(message);
        expect(listener.mock.calls[0][1]).toMatchObject({
          timestamp,
          type: 'test'
        });
      });
    });

    describe('@complex routing', () => {
      const exchange = uuid.v4();
      const queue1 = uuid.v4();
      const queue2 = uuid.v4();
      const routingKey1 = 'route.1';
      const message1 = { a: 1 };
      const routingKey2 = 'route.2';
      const message2 = { b: 2 };

      beforeAll(async () => {
        await bus.connect();
        await bus.assertExchange(exchange, 'topic');
        await bus.assertQueue(queue1);
        await bus.bindQueue(queue1, exchange, routingKey1);
        await bus.assertQueue(queue2);
        await bus.bindQueue(queue2, exchange, routingKey2);
      });
      afterAll(async () => {
        await bus.unbindQueue(queue1, exchange, routingKey1);
        await bus.deleteQueue(queue1);
        await bus.unbindQueue(queue2, exchange, routingKey2);
        await bus.deleteQueue(queue2);
        await bus.disconnect();
      });

      it('routes message correctly', async () => {
        const listener1 = jest.fn((msg, props, done) => done());
        await bus.subscribe(queue1, listener1);

        const listener2 = jest.fn((msg, props, done) => done());
        await bus.subscribe(queue2, listener2);

        const timestamp = Date.now();
        await bus.publish(exchange, routingKey1, message1, {
          timestamp,
          type: 'test-1'
        });
        await bus.publish(exchange, routingKey2, message2, {
          timestamp,
          type: 'test-2'
        });
        await Promise.delay(100); // required for test case to work

        expect(listener1).toHaveBeenCalled();
        expect(listener1.mock.calls[0][0]).toEqual(message1);
        expect(listener1.mock.calls[0][1]).toMatchObject({
          timestamp,
          type: 'test-1'
        });

        expect(listener2).toHaveBeenCalled();
        expect(listener2.mock.calls[0][0]).toEqual(message2);
        expect(listener2.mock.calls[0][1]).toMatchObject({
          timestamp,
          type: 'test-2'
        });
      });
    });
  });
});
