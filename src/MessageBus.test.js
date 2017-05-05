/* eslint-env jest */

import Promise from 'bluebird';
import 'dotenv/config'; // load env variables
import MessageBus from './MessageBus';

describe('MessageBus', () => {
  describe('constructor()', () => {
    it('throws error when spec is unspecified', () => {
      expect(() => new MessageBus())
        .toThrowError('Invalid "spec" param; expected plain object, received undefined');
    });

    it('throws error when spec is invalid', () => {
      expect(() => new MessageBus(123))
        .toThrowError('Invalid "spec" param; expected plain object, received number');
      expect(() => new MessageBus('foo'))
        .toThrowError('Invalid "spec" param; expected plain object, received string');
      expect(() => new MessageBus(null))
        .toThrowError('Invalid "spec" param; expected plain object, received null');
      expect(() => new MessageBus(true))
        .toThrowError('Invalid "spec" param; expected plain object, received boolean');
      expect(() => new MessageBus([]))
        .toThrowError('Invalid "spec" param; expected plain object, received array');
    });

    it('throws error when url is unspecified', () => {
      expect(() => new MessageBus({}))
        .toThrowError('Invalid "url" property; expected string, received undefined');
    });

    it('throws error when queue is unspecified', () => {
      expect(() => new MessageBus({ url: process.env.RABBITMQ_URL }))
        .toThrowError('Invalid "queue" property; expected string, received undefined');
    });

    it('throws error when password is unspecified', () => {
      expect(() => new MessageBus({ url: process.env.RABBITMQ_URL, queue: '__test__' }))
        .toThrowError('Invalid "password" property; expected string, received undefined');
    });
  });

  const bus = new MessageBus({
    queue: '__test__',
    url: process.env.RABBITMQ_URL,
    password: process.env.MESSAGE_BUS_PASSWORD
  });

  describe('connect()', () => {
    it('connects to AMQP server', async () => {
      expect(bus.conn).toBe(null);
      await bus.connect();
      expect(bus.conn).not.toBe(null);
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
    });

    it('does not throw if called twice', async () => {
      await bus.disconnect();
      expect(bus.conn).toBe(null);
    });
  });

  describe('subscribe()', () => {
    it('throws error when callback is unspecified', async () => {
      try {
        await bus.subscribe();
      } catch (err) {
        expect(err.message).toBe('Invalid "callback" param; expected function, received undefined');
      }
    });

    it('throws error when callback is invalid', async () => {
      try {
        await bus.subscribe(123);
      } catch (err) {
        expect(err.message).toBe('Invalid "callback" param; expected function, received number');
      }

      try {
        await bus.subscribe('foo');
      } catch (err) {
        expect(err.message).toBe('Invalid "callback" param; expected function, received string');
      }

      try {
        await bus.subscribe(null);
      } catch (err) {
        expect(err.message).toBe('Invalid "callback" param; expected function, received null');
      }

      try {
        await bus.subscribe(true);
      } catch (err) {
        expect(err.message).toBe('Invalid "callback" param; expected function, received boolean');
      }

      try {
        await bus.subscribe({});
      } catch (err) {
        expect(err.message).toBe('Invalid "callback" param; expected function, received object');
      }

      try {
        await bus.subscribe([]);
      } catch (err) {
        expect(err.message).toBe('Invalid "callback" param; expected function, received array');
      }
    });

    describe('@disconnected', () => {
      it('cannot subscribe to message bus', async () => {
        try {
          await bus.subscribe((msg, props, done) => done());
        } catch (err) {
          expect(err.message).toBe('Cannot subscribe to message bus; did you forget to call #connect()');
        }
      });
    });

    describe('@connected', () => {
      beforeAll(async () => bus.connect());
      afterAll(async () => bus.disconnect());

      it('subscribes to messages', async () => {
        const listener = jest.fn((msg, props, done) => done());
        await bus.subscribe(listener);
        await bus.publish('foobar', { type: 'gapps:test' });
        await Promise.delay(100); // required for test case to work
        expect(listener).toHaveBeenCalled();
        expect(listener.mock.calls[0][0]).toBe('foobar');
        expect(listener.mock.calls[0][1].type).toBe('gapps:test');
      });

      it('throws error when calling subscribe twice', async () => {
        try {
          await bus.subscribe((msg, props, done) => done());
        } catch (err) {
          expect(err.message).toMatch(/Subscription already active/);
        }
      });
    });
  });

  describe('publish()', () => {
    it('throws error when content is unspecified', async () => {
      try {
        await bus.publish();
      } catch (err) {
        expect(err.message).toBe('Invalid "content" param; must be specified');
      }
    });

    it('throws error when props is invalid', async () => {
      try {
        await bus.publish('foo', 123);
      } catch (err) {
        expect(err.message).toBe('Invalid "props" param; expected plain object, received number');
      }

      try {
        await bus.publish('foo', true);
      } catch (err) {
        expect(err.message).toBe('Invalid "props" param; expected plain object, received boolean');
      }

      try {
        await bus.publish('foo', 'abc');
      } catch (err) {
        expect(err.message).toBe('Invalid "props" param; expected plain object, received string');
      }

      try {
        await bus.publish('foo', []);
      } catch (err) {
        expect(err.message).toBe('Invalid "props" param; expected plain object, received array');
      }

      try {
        await bus.publish('foo', () => console.log(1));
      } catch (err) {
        expect(err.message).toBe('Invalid "props" param; expected plain object, received function');
      }
    });

    describe('@disconnected', () => {
      it('cannot publish to message bus', async () => {
        try {
          await bus.publish('foo');
        } catch (err) {
          expect(err.message).toMatch(/Cannot publish to message bus/);
        }
      });
    });

    describe('@connected', () => {
      beforeAll(async () => bus.connect());
      afterAll(async () => bus.disconnect());

      it('publishes message with custom properties', async () => {
        const listener = jest.fn((msg, props, done) => done());
        await bus.subscribe(listener);
        const timestamp = Date.now();
        await bus.publish({ a: 1, b: 2 }, { timestamp, type: 'gapps:test' });
        await Promise.delay(100); // required for test case to work
        expect(listener).toHaveBeenCalled();
        expect(listener.mock.calls[0][0]).toEqual({ a: 1, b: 2 });
        expect(listener.mock.calls[0][1]).toMatchObject({
          timestamp,
          type: 'gapps:test'
        });
      });
    });
  });
});
