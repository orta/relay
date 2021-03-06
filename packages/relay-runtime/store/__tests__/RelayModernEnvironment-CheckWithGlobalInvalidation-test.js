/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @flow strict-local
 * @emails oncall+relay
 */

// flowlint ambiguous-object-type:error

'use strict';

const RelayModernEnvironment = require('../RelayModernEnvironment');
const RelayModernStore = require('../RelayModernStore');
const RelayNetwork = require('../../network/RelayNetwork');
const RelayObservable = require('../../network/RelayObservable');
const RelayRecordSource = require('../RelayRecordSource');

const {
  createOperationDescriptor,
} = require('../RelayModernOperationDescriptor');
const {generateAndCompile} = require('relay-test-utils-internal');

describe('check() with global invalidation', () => {
  let environment;
  let operation;
  let ParentQuery;
  let source;
  let store;
  let complete;
  let error;
  let next;
  let callbacks;
  let dataSource;
  let fetch;

  beforeEach(() => {
    jest.resetModules();
    ({ParentQuery} = generateAndCompile(`
        query ParentQuery($size: [Int]!) {
          me {
            id
            name
            profilePicture(size: $size) {
              uri
            }
          }
        }
      `));
    operation = createOperationDescriptor(ParentQuery, {size: 32});

    complete = jest.fn();
    error = jest.fn();
    next = jest.fn();
    callbacks = {complete, error, next};
    fetch = (_query, _variables, _cacheConfig) => {
      return RelayObservable.create(sink => {
        dataSource = sink;
      });
    };
    source = RelayRecordSource.create();
    store = new RelayModernStore(source);
    environment = new RelayModernEnvironment({
      network: RelayNetwork.create(fetch),
      store,
    });
  });

  describe('when store is invalidated before query has ever been written to the store', () => {
    it('returns available after receiving query from the server', () => {
      store.invalidate();

      environment.retain(operation);
      environment.execute({operation}).subscribe(callbacks);
      const payload = {
        data: {
          me: {
            __typename: 'User',
            id: '4',
            name: 'Zuck',
            profilePicture: {
              uri: 'https://...',
            },
          },
        },
      };
      dataSource.next(payload);
      dataSource.complete();
      jest.runAllTimers();

      expect(environment.check(operation)).toBe('available');
    });

    it('returns missing if some data is missing after receiving query from the server', () => {
      store.invalidate();

      environment.retain(operation);
      environment.execute({operation}).subscribe(callbacks);
      const payload = {
        data: {
          me: {
            __typename: 'User',
            id: '4',
            name: 'Zuck',
            profilePicture: {
              uri: undefined,
            },
          },
        },
      };
      dataSource.next(payload);
      dataSource.complete();
      jest.runAllTimers();

      expect(environment.check(operation)).toBe('missing');
    });
  });

  describe('when store is invalidated after query has been written to the store', () => {
    it('returns stale even if full query is cached', () => {
      environment.retain(operation);
      environment.execute({operation}).subscribe(callbacks);
      const payload = {
        data: {
          me: {
            __typename: 'User',
            id: '4',
            name: 'Zuck',
            profilePicture: {
              uri: 'https://...',
            },
          },
        },
      };
      dataSource.next(payload);
      dataSource.complete();
      jest.runAllTimers();

      store.invalidate();

      // Should return stale even if all data is cached since
      // store was invalidated after query completed
      expect(environment.check(operation)).toBe('stale');
    });

    it('returns stale if some data is missing', () => {
      environment.retain(operation);
      environment.execute({operation}).subscribe(callbacks);
      const payload = {
        data: {
          me: {
            __typename: 'User',
            id: '4',
            name: 'Zuck',
            profilePicture: {
              uri: undefined,
            },
          },
        },
      };
      dataSource.next(payload);
      dataSource.complete();
      jest.runAllTimers();

      store.invalidate();

      expect(environment.check(operation)).toBe('stale');
    });
  });

  describe('when query is refetched after store is invalidated', () => {
    it('returns available if data is available after refetch', () => {
      environment.retain(operation);
      environment.execute({operation}).subscribe(callbacks);
      let payload = {
        data: {
          me: {
            __typename: 'User',
            id: '4',
            name: 'Zuck',
            profilePicture: {
              uri: 'https://...',
            },
          },
        },
      };
      dataSource.next(payload);
      dataSource.complete();
      jest.runAllTimers();

      store.invalidate();

      // Expect data to not be available after invalidation
      expect(environment.check(operation)).toBe('stale');

      environment.execute({operation}).subscribe(callbacks);
      payload = {
        data: {
          me: {
            __typename: 'User',
            id: '4',
            name: 'Zuck',
            profilePicture: {
              uri: 'https://...',
            },
          },
        },
      };
      dataSource.next(payload);
      dataSource.complete();
      jest.runAllTimers();

      // Expect data be available after refetch
      expect(environment.check(operation)).toBe('available');
    });

    it('returns missing if data is not available after refetch', () => {
      environment.retain(operation);
      environment.execute({operation}).subscribe(callbacks);
      let payload = {
        data: {
          me: {
            __typename: 'User',
            id: '4',
            name: 'Zuck',
            profilePicture: {
              uri: undefined,
            },
          },
        },
      };
      dataSource.next(payload);
      dataSource.complete();
      jest.runAllTimers();

      store.invalidate();

      // Expect data to not be available after invalidation
      expect(environment.check(operation)).toBe('stale');

      environment.execute({operation}).subscribe(callbacks);
      payload = {
        data: {
          me: {
            __typename: 'User',
            id: '4',
            name: 'Zuck',
            profilePicture: {
              uri: undefined,
            },
          },
        },
      };
      dataSource.next(payload);
      dataSource.complete();
      jest.runAllTimers();

      expect(environment.check(operation)).toBe('missing');
    });
  });

  describe('when query has incremental payloads', () => {
    beforeEach(() => {
      ({ParentQuery} = generateAndCompile(`
        query ParentQuery($size: [Int]!) {
          me {
            id
            name
            ...UserFragment @defer(label: "UserFragment")
          }
        }

        fragment UserFragment on User {
          profilePicture(size: $size) {
            uri
          }
        }
      `));
      operation = createOperationDescriptor(ParentQuery, {size: 32});
    });

    describe('when store is invalidated before query has been written to the store', () => {
      it('returns available after receiving payloads from the server', () => {
        store.invalidate();

        environment.retain(operation);
        environment.execute({operation}).subscribe(callbacks);
        const payload = {
          data: {
            me: {
              __typename: 'User',
              id: '4',
              name: 'Zuck',
            },
          },
        };
        dataSource.next(payload);
        jest.runAllTimers();
        next.mockClear();

        // Still missing incremental payload
        expect(environment.check(operation)).toBe('missing');

        dataSource.next({
          data: {
            id: '1',
            __typename: 'User',
            profilePicture: {
              uri: 'https://...',
            },
          },
          label: 'ParentQuery$defer$UserFragment',
          path: ['me'],
        });
        dataSource.complete();
        jest.runAllTimers();

        // Data for whole query should be available now
        expect(environment.check(operation)).toBe('available');
      });

      it('returns missing after receiving payloads from the server if data is still missing', () => {
        store.invalidate();

        environment.retain(operation);
        environment.execute({operation}).subscribe(callbacks);
        const payload = {
          data: {
            me: {
              __typename: 'User',
              id: '4',
              name: 'Zuck',
            },
          },
        };
        dataSource.next(payload);
        jest.runAllTimers();
        next.mockClear();

        // Still missing incremental payload
        expect(environment.check(operation)).toBe('missing');

        dataSource.next({
          data: {
            id: '1',
            __typename: 'User',
            profilePicture: {
              uri: undefined,
            },
          },
          label: 'ParentQuery$defer$UserFragment',
          path: ['me'],
        });
        dataSource.complete();
        jest.runAllTimers();

        // Data is still missing
        expect(environment.check(operation)).toBe('missing');
      });
    });

    describe('when store is invalidated in between incremental payloads', () => {
      it('returns stale after receiving payloads from the server', () => {
        environment.retain(operation);
        environment.execute({operation}).subscribe(callbacks);
        const payload = {
          data: {
            me: {
              __typename: 'User',
              id: '4',
              name: 'Zuck',
            },
          },
        };
        dataSource.next(payload);
        jest.runAllTimers();
        next.mockClear();

        // Still missing incremental payload
        expect(environment.check(operation)).toBe('missing');

        // Invalidate the store in between incremental payloads
        store.invalidate();

        dataSource.next({
          data: {
            id: '1',
            __typename: 'User',
            profilePicture: {
              uri: 'https://...',
            },
          },
          label: 'ParentQuery$defer$UserFragment',
          path: ['me'],
        });
        dataSource.complete();
        jest.runAllTimers();

        // Should return false even if all data is cached since
        // store was invalidated after first payload was written
        expect(environment.check(operation)).toBe('stale');
      });

      it('returns stale after receiving payloads from the server and data is still missing', () => {
        environment.retain(operation);
        environment.execute({operation}).subscribe(callbacks);
        const payload = {
          data: {
            me: {
              __typename: 'User',
              id: '4',
              name: 'Zuck',
            },
          },
        };
        dataSource.next(payload);
        jest.runAllTimers();
        next.mockClear();

        // Still missing incremental payload
        expect(environment.check(operation)).toBe('missing');

        // Invalidate the store in between incremental payloads
        store.invalidate();

        dataSource.next({
          data: {
            id: '1',
            __typename: 'User',
            profilePicture: {
              uri: undefined,
            },
          },
          label: 'ParentQuery$defer$UserFragment',
          path: ['me'],
        });
        dataSource.complete();
        jest.runAllTimers();

        expect(environment.check(operation)).toBe('stale');
      });
    });

    describe('when store is invalidated after all incremental payloads have been written to the store', () => {
      it('returns stale after receiving payloads from the server', () => {
        environment.retain(operation);
        environment.execute({operation}).subscribe(callbacks);
        const payload = {
          data: {
            me: {
              __typename: 'User',
              id: '4',
              name: 'Zuck',
            },
          },
        };
        dataSource.next(payload);
        jest.runAllTimers();
        next.mockClear();

        // Still missing incremental payload
        expect(environment.check(operation)).toBe('missing');

        dataSource.next({
          data: {
            id: '1',
            __typename: 'User',
            profilePicture: {
              uri: 'https://...',
            },
          },
          label: 'ParentQuery$defer$UserFragment',
          path: ['me'],
        });
        dataSource.complete();
        jest.runAllTimers();

        // Invalidate the store after query has completed
        store.invalidate();

        // Should return stale even if all data is cached since
        // store was invalidated after query completed
        expect(environment.check(operation)).toBe('stale');
      });

      it('returns stale after receiving payloads from the server and data is still missing', () => {
        environment.retain(operation);
        environment.execute({operation}).subscribe(callbacks);
        const payload = {
          data: {
            me: {
              __typename: 'User',
              id: '4',
              name: 'Zuck',
            },
          },
        };
        dataSource.next(payload);
        jest.runAllTimers();
        next.mockClear();

        // Still missing incremental payload
        expect(environment.check(operation)).toBe('missing');

        dataSource.next({
          data: {
            id: '1',
            __typename: 'User',
            profilePicture: {
              uri: undefined,
            },
          },
          label: 'ParentQuery$defer$UserFragment',
          path: ['me'],
        });
        dataSource.complete();
        jest.runAllTimers();

        // Invalidate the store after query has completed
        store.invalidate();

        expect(environment.check(operation)).toBe('stale');
      });
    });
  });
});
