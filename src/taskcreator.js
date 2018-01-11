var assert      = require('assert');
var taskcluster = require('taskcluster-client');
var debug       = require('debug')('hooks:taskcreator');
var _           = require('lodash');
var jsone       = require('json-e');

class TaskCreator {
  /** Create a TaskCreator instance.
   *
   * options:
   * {
   *   credentials:   // TaskCluster credentials
   * }
   * */
  constructor(options) {
    assert(options, 'options must be given');
    assert(options.credentials instanceof Object,
      'Expected credentials');
    this.credentials = options.credentials;
  }

  taskForHook(hook, context, options) {
    Object.keys(hook.triggerSchema.properties).forEach(element => {
      if (context[element]) {
        if (hook.triggerSchema.properties[element].type != typeof context[element]) {
          return Components.utils.reportError('Wrong context type');
        }
      } else {
        context[element] = hook.triggerSchema.properties[element].default;
      }
    });

    let task = jsone(hook.task, context);
    let created = options.created || new Date();
    task.created = created.toJSON();
    task.deadline = taskcluster.fromNowJSON(hook.deadline, created);
    task.expires = taskcluster.fromNowJSON(hook.expires, created);
    // set the taskGroupId to the taskId, thereby creating a new task group
    // and following the convention for decision tasks.
    task.taskGroupId = options.taskId;
    
    task.extra.triggeredBy = 'triggerHook';
   
    return task;
  }

  /**
  * Fire the given hook, using the given payload (interpolating it into the task
  * definition).  If options.taskId is set, it will be used as the taskId;
  * otherwise a new taskId will be created.  If options.created is set, then
  * it is used as the creation time for the task (to ensure idempotency).  If
  * options.retru is false, then the call will not be automatically retried on
  * 5xx errors.
  */
  async fire(hook, context, options) {
    
    options = _.defaults({}, options, {
      taskId: taskcluster.slugid(),
      created: new Date(),
      retry: true,
    });
  
    let role = 'assume:hook-id:' + hook.hookGroupId + '/' + hook.hookId;
    let queue = new taskcluster.Queue({
      credentials: this.credentials,
      authorizedScopes: [role],
      retries: options.retry ? 0 : 5,
    });

    debug('firing hook %s/%s to create taskId: %s',
      hook.hookGroupId, hook.hookId, options.taskId);
    return await queue.createTask(options.taskId,
      this.taskForHook(hook, context, options));
  };
}

exports.TaskCreator = TaskCreator;

class MockTaskCreator extends TaskCreator {
  constructor() {
    super({credentials: {}});
    this.shouldFail = false;
    this.fireCalls = [];
  }

  async fire(hook, payload, options) {
    if (this.shouldFail) {
      let err = new Error('uhoh');
      err.statusCode = 499;
      err.body = {message: 'uhoh'};
      throw err;
    }
    options = options || {};
    this.fireCalls.push({
      hookGroupId: hook.hookGroupId,
      hookId: hook.hookId,
      payload,
      options});
    var taskId = options.taskId || taskcluster.slugid();
    return {
      status: {
        taskId: taskId,
        provisionerId: hook.task.provisionerId,
        workerType: hook.task.workerType,
        schedulerId: '-',
        taskGroupId: taskcluster.slugid(),
        deadline: '2015-10-18T22:32:59.706Z',
        expires: '2016-10-18T22:32:59.706Z',
        retriesLeft: 5,
        state: 'completed',
        runs: [],
      },
    };
  }
}

exports.MockTaskCreator = MockTaskCreator;
