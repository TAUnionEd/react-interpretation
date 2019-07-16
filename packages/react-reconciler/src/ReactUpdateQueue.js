/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// UpdateQueue is a linked list of prioritized updates.
//
// UpdateQueue 是一个用来评估 update 优先级的链表。
//
// Like fibers, update queues come in pairs: a current queue, which represents
// the visible state of the screen, and a work-in-progress queue, which can be
// mutated and processed asynchronously before it is committed — a form of
// double buffering. If a work-in-progress render is discarded before finishing,
// we create a new work-in-progress by cloning the current queue.
//
// 和 fiber 一样，updateQueue 也是成对的、双缓冲的：一个当前队列，代表着当前显示的 state；
// 一个 work-in-progress（正在处理中的）队列，在 commit 前，这个队列可以被异步的改变或处理。
// 如果一个正在处理中的 render 在结束前被丢弃了，我们会将当前队列克隆一份，并把他当作
// workInProgress 队列。
//
// Both queues share a persistent, singly-linked list structure. To schedule an
// update, we append it to the end of both queues. Each queue maintains a
// pointer to first update in the persistent list that hasn't been processed.
// The work-in-progress pointer always has a position equal to or greater than
// the current queue, since we always work on that one. The current queue's
// pointer is only updated during the commit phase, when we swap in the
// work-in-progress.
//
// 每个队列都使用一个持久的单向链表结构（持久性指 update 在处理过程中属性不会发生变化）。
// 每次调度一个 update，我们就会把他放到这两个链表的末尾。每个队列都持有一个指针，
// 指向这个持久化的列表中第一个还没被处理的 update。workInProgress 上的指针（firstUpdate）
// 会保持指向当前 UpdateQueue 所指向的 update，或其之后的 update
//（即 workInProgress 的处理进度总是等于或快于当前 UpdateQueue），
// 因为我们处理队列时，实际上是在对 workInProgress 进行操作（而非当前 UpdateQueue）。
// 当前 UpdateQueue 的指针（firstUpdate）仅在 commit 过程中会被更新，
// 届时我们会将 workInProgress（与当前队列）交换。
//
// For example:
//
//   Current pointer:           A - B - C - D - E - F
//   Work-in-progress pointer:              D - E - F
//                                          ^
//                                          The work-in-progress queue has
//                                          processed more updates than current.
//                                    workInProgress 队列已经比当前队列处理了更多的 update
//
// The reason we append to both queues is because otherwise we might drop
// updates without ever processing them. For example, if we only add updates to
// the work-in-progress queue, some updates could be lost whenever a work-in
// -progress render restarts by cloning from current. Similarly, if we only add
// updates to the current queue, the updates will be lost whenever an already
// in-progress queue commits and swaps with the current queue. However, by
// adding to both queues, we guarantee that the update will be part of the next
// work-in-progress. (And because the work-in-progress queue becomes the
// current queue once it commits, there's no danger of applying the same
// update twice.)
//
// 我们将需要调度的 update 同时加到两个队列里，是因为若不这么做，我们有可能在处理之前就删掉了他们。
// 举个栗子，如果我们仅将新的 update 加到 workInProgress 队列中，有些 update 会在 workInProgress
// render 重新开始时，因为从当前队列克隆一份覆盖了 workInProgress，从而被丢弃。
// 类似的，如果我们仅将新的 update 加到当前队列中。有些 update 会在 workInProgress 执行结束开始
// commit 过程时，因为和当前队列发生交换，从而被丢弃。不论如何，通过将新 update 同时添加到两个队列里，
// 我们能保证新的 update 能成为之后 workInProgress 队列中的一部分。
//（并且因为 workInProgress 队列一旦 commit 就变成了当前队列，所以没有进行两次相同更新的风险）
//
// Prioritization  优先级
// --------------
//
// Updates are not sorted by priority, but by insertion; new updates are always
// appended to the end of the list.
//
// update 并不按优先级排序，而是按插入的先后排序的；新的 update 一定会放在链表的末尾。
//
// The priority is still important, though. When processing the update queue
// during the render phase, only the updates with sufficient priority are
// included in the result. If we skip an update because it has insufficient
// priority, it remains in the queue to be processed later, during a lower
// priority render. Crucially, all updates subsequent to a skipped update also
// remain in the queue *regardless of their priority*. That means high priority
// updates are sometimes processed twice, at two separate priorities. We also
// keep track of a base state, that represents the state before the first
// update in the queue is applied.
//
// 优先级一直是一件重要的事。当在 render 阶段处理 update 队列时，只有有最够高优先级的 update
// 所执行的结果会被包含在最终的结果内。如果我们跳过了一个 update，那么就是因为他优先级不够高，
// 这意味着在队列中他会在之后的低优先级 render 过程中被执行。最重要的是，被跳过的更新之后的
// 所有更新都会被保留在队列中，*无论之后这些 update 的优先级如何*。这意味着高优先级的 update
// 可能会在两个不同的优先级中被执行两遍。同时我们还会跟踪 baseState，我们将会保持 baseState
// 为队列中第一次更新发生前的状态。
//
// For example:
// 举个栗子：
//
//   Given a base state of '', and the following queue of updates
//   假设 baseState 为空字符串 ''，且有如下的 update 队列
//
//     A1 - B2 - C1 - D2
//
//   where the number indicates the priority, and the update is applied to the
//   previous state by appending a letter, React will process these updates as
//   two separate renders, one per distinct priority level:
//   其中的数字代表着他们的优先级，字母代表着需要添加到 state 中的字符，React 会在两次
//   独立的 render 过程中执行他们，每次执行过程的优先级不同：
//
//   First render, at priority 1:
//   第一次 render，优先级为 1：
//     Base state: ''
//     Updates: [A1, C1]
//     Result state: 'AC'
//
//   Second render, at priority 2:
//   第二次 render，优先级为 2：
//     Base state: 'A'            <-  The base state does not include C1,
//                                    because B2 was skipped.
//                                这里 baseState 不包括 C1，因为 B2 被跳过了。
//                      也就是上文所谓的“保持 baseState 为队列中第一次更新发生前的状态”
//     Updates: [B2, C1, D2]      <-  C1 was rebased on top of B2
//     Result state: 'ABCD'           C1 会 rebase 顶部 B2 执行的结果
//
// Because we process updates in insertion order, and rebase high priority
// updates when preceding updates are skipped, the final result is deterministic
// regardless of priority. Intermediate state may vary according to system
// resources, but the final state is always the same.
//
// 因为我们按照入队列的顺序执行 update，并且有 update 被跳过时会 rebase 高优先级的 update，
// 所以无论优先级如何，最终的结果都是确定的。其中间 state 可能会因系统资源问题有所不同，但最终的
// state 都是一致的。

import type {Fiber} from './ReactFiber';
import type {ExpirationTime} from './ReactFiberExpirationTime';

import {NoWork} from './ReactFiberExpirationTime';
import {
  enterDisallowedContextReadInDEV,
  exitDisallowedContextReadInDEV,
} from './ReactFiberNewContext';
import {Callback, ShouldCapture, DidCapture} from 'shared/ReactSideEffectTags';
import {ClassComponent} from 'shared/ReactWorkTags';

import {
  debugRenderPhaseSideEffects,
  debugRenderPhaseSideEffectsForStrictMode,
} from 'shared/ReactFeatureFlags';

import {StrictMode} from './ReactTypeOfMode';

import invariant from 'shared/invariant';
import warningWithoutStack from 'shared/warningWithoutStack';

export type Update<State> = {
  // 更新的过期时间，从 fiber 中读取而来
  expirationTime: ExpirationTime,

  // 更新的类型，他们具体的作用见本文件 function getStateFromUpdate
  // tag 用来指导 update 的 state 更新策略
  tag: 0 | 1 | 2 | 3,
  // render 创建的 payload 即为 { element }
  // setState 创建的 payload 为其第一个参数，即一个 object 或 function
  payload: any,
  // 会在 commit 阶段触发
  callback: (() => mixed) | null,

  // Update 实际上也是一个链表结构，每增加一个 update 就会放到链表的末尾
  next: Update<State> | null,
  // 下一个 effect 的 update
  nextEffect: Update<State> | null,
};

export type UpdateQueue<State> = {
  // 队列里的每个 update 被执行时，update 就会更新 baseState。根据 update.tag 的不同，
  // update 的结果和 baseState 可能会做替代、捕获、合并或跳过操作。
  // 这些操作见本文件 function getStateFromUpdate
  baseState: State,

  // update 链表的首尾
  firstUpdate: Update<State> | null,
  lastUpdate: Update<State> | null,

  // 捕获类型 update 链表的首尾
  firstCapturedUpdate: Update<State> | null,
  lastCapturedUpdate: Update<State> | null,

  // 有副作用的 update 链表的首尾，
  // 一般的，调用 `processUpdateQueue` 过程中，
  // 带有 callback 的 update 会被放到 effect update 链表中，
  // 之后会通过 `commitUpdateEffects` 进行处理
  firstEffect: Update<State> | null,
  lastEffect: Update<State> | null,

  // 和普通 effect 链表类似，只针对捕获类型的 update
  firstCapturedEffect: Update<State> | null,
  lastCapturedEffect: Update<State> | null,
};

// 具体的作用见本文件 function getStateFromUpdate
export const UpdateState = 0;
export const ReplaceState = 1;
export const ForceUpdate = 2;
export const CaptureUpdate = 3;

// Global state that is reset at the beginning of calling `processUpdateQueue`.
// It should only be read right after calling `processUpdateQueue`, via
// `checkHasForceUpdateAfterProcessing`.
// 全局变量 hasForceUpdate，会在 `processUpdateQueue` 一开始就置回 false。
// 这个变量仅应当在调用 `processUpdateQueue` 后，通过 `checkHasForceUpdateAfterProcessing` 读取。
let hasForceUpdate = false;

let didWarnUpdateInsideUpdate;
let currentlyProcessingQueue;
export let resetCurrentlyProcessingQueue;
if (__DEV__) {
  didWarnUpdateInsideUpdate = false;
  currentlyProcessingQueue = null;
  resetCurrentlyProcessingQueue = () => {
    currentlyProcessingQueue = null;
  };
}

export function createUpdateQueue<State>(baseState: State): UpdateQueue<State> {
  const queue: UpdateQueue<State> = {
    baseState,
    firstUpdate: null,
    lastUpdate: null,
    firstCapturedUpdate: null,
    lastCapturedUpdate: null,
    firstEffect: null,
    lastEffect: null,
    firstCapturedEffect: null,
    lastCapturedEffect: null,
  };
  return queue;
}

// 克隆队列，对 `baseState`，`firstUpdate` 和 `lastUpdate` 进行浅拷贝
function cloneUpdateQueue<State>(
  currentQueue: UpdateQueue<State>,
): UpdateQueue<State> {
  const queue: UpdateQueue<State> = {
    baseState: currentQueue.baseState,
    firstUpdate: currentQueue.firstUpdate,
    lastUpdate: currentQueue.lastUpdate,

    // TODO: With resuming, if we bail out and resuse the child tree, we should
    // keep these effects.
    // 这里 React 有计划在 render 中断后恢复时，复用 queue 中有关子树的字段。
    firstCapturedUpdate: null,
    lastCapturedUpdate: null,

    firstEffect: null,
    lastEffect: null,

    firstCapturedEffect: null,
    lastCapturedEffect: null,
  };
  return queue;
}

export function createUpdate(expirationTime: ExpirationTime): Update<*> {
  return {
    expirationTime: expirationTime,

    tag: UpdateState,
    payload: null,
    callback: null,

    next: null,
    nextEffect: null,
  };
}

function appendUpdateToQueue<State>(
  queue: UpdateQueue<State>,
  update: Update<State>,
) {
  // Append the update to the end of the list.
  // 将 update 添加到链表的末尾
  if (queue.lastUpdate === null) {
    // Queue is empty
    // 链表为空时将首尾都指向当前 update
    queue.firstUpdate = queue.lastUpdate = update;
  } else {
    queue.lastUpdate.next = update;
    queue.lastUpdate = update;
  }
}

export function enqueueUpdate<State>(fiber: Fiber, update: Update<State>) {
  // Update queues are created lazily.
  // UpdateQueue 是懒创建的。换言之 enqueue 执行的是一种 upsert 操作。
  const alternate = fiber.alternate;
  let queue1;
  let queue2;
  if (alternate === null) {
    // There's only one fiber.
    // fiber 没有 alternate 时，我们仅操作 fiber 自己的队列
    queue1 = fiber.updateQueue;
    queue2 = null;
    if (queue1 === null) {
      queue1 = fiber.updateQueue = createUpdateQueue(fiber.memoizedState);
    }
  } else {
    // There are two owners.
    // fiber 拥有 alternate 时，我们同时操作两者的队列，两个队列在发生操作时应当互为为克隆
    // 其中一者为 null 则进行克隆，双方为 null 则同时新建
    queue1 = fiber.updateQueue;
    queue2 = alternate.updateQueue;
    if (queue1 === null) {
      if (queue2 === null) {
        // Neither fiber has an update queue. Create new ones.
        queue1 = fiber.updateQueue = createUpdateQueue(fiber.memoizedState);
        queue2 = alternate.updateQueue = createUpdateQueue(
          alternate.memoizedState,
        );
      } else {
        // Only one fiber has an update queue. Clone to create a new one.
        queue1 = fiber.updateQueue = cloneUpdateQueue(queue2);
      }
    } else {
      if (queue2 === null) {
        // Only one fiber has an update queue. Clone to create a new one.
        queue2 = alternate.updateQueue = cloneUpdateQueue(queue1);
      } else {
        // Both owners have an update queue.
      }
    }
  }

  // 同样的，新 update 也要同时放到两个队列里
  if (queue2 === null || queue1 === queue2) {
    // There's only a single queue.
    appendUpdateToQueue(queue1, update);
  } else {
    // There are two queues. We need to append the update to both queues,
    // while accounting for the persistent structure of the list — we don't
    // want the same update to be added multiple times.
    if (queue1.lastUpdate === null || queue2.lastUpdate === null) {
      // One of the queues is not empty. We must add the update to both queues.
      appendUpdateToQueue(queue1, update);
      appendUpdateToQueue(queue2, update);
    } else {
      // Both queues are non-empty. The last update is the same in both lists,
      // because of structural sharing. So, only append to one of the lists.
      appendUpdateToQueue(queue1, update);
      // But we still need to update the `lastUpdate` pointer of queue2.
      queue2.lastUpdate = update;
    }
  }

  if (__DEV__) {
    if (
      fiber.tag === ClassComponent &&
      (currentlyProcessingQueue === queue1 ||
        (queue2 !== null && currentlyProcessingQueue === queue2)) &&
      !didWarnUpdateInsideUpdate
    ) {
      warningWithoutStack(
        false,
        'An update (setState, replaceState, or forceUpdate) was scheduled ' +
          'from inside an update function. Update functions should be pure, ' +
          'with zero side-effects. Consider using componentDidUpdate or a ' +
          'callback.',
      );
      didWarnUpdateInsideUpdate = true;
    }
  }
}

export function enqueueCapturedUpdate<State>(
  workInProgress: Fiber,
  update: Update<State>,
) {
  // Captured updates go into a separate list, and only on the work-in-
  // progress queue.
  let workInProgressQueue = workInProgress.updateQueue;
  if (workInProgressQueue === null) {
    workInProgressQueue = workInProgress.updateQueue = createUpdateQueue(
      workInProgress.memoizedState,
    );
  } else {
    // TODO: I put this here rather than createWorkInProgress so that we don't
    // clone the queue unnecessarily. There's probably a better way to
    // structure this.
    workInProgressQueue = ensureWorkInProgressQueueIsAClone(
      workInProgress,
      workInProgressQueue,
    );
  }

  // Append the update to the end of the list.
  if (workInProgressQueue.lastCapturedUpdate === null) {
    // This is the first render phase update
    workInProgressQueue.firstCapturedUpdate = workInProgressQueue.lastCapturedUpdate = update;
  } else {
    workInProgressQueue.lastCapturedUpdate.next = update;
    workInProgressQueue.lastCapturedUpdate = update;
  }
}

function ensureWorkInProgressQueueIsAClone<State>(
  workInProgress: Fiber,
  queue: UpdateQueue<State>,
): UpdateQueue<State> {
  const current = workInProgress.alternate;
  if (current !== null) {
    // If the work-in-progress queue is equal to the current queue,
    // we need to clone it first.
    // 如果 work-in-progress 队列和当前处理的队列相同，
    // 我们则需要先克隆一份当前队列当作 work-in-progress 队列。
    // 这样即可保证 work-in-progress 是一份克隆而不是 current 本身。
    if (queue === current.updateQueue) {
      queue = workInProgress.updateQueue = cloneUpdateQueue(queue);
    }
  }
  return queue;
}

// 通过 Update 计算 state
// 这个方法会根据 update.tag 对 state 进行不同的操作，
// 最终返回新的 state
function getStateFromUpdate<State>(
  workInProgress: Fiber,
  queue: UpdateQueue<State>,
  update: Update<State>,
  prevState: State,
  nextProps: any,
  instance: any,
): any {
  switch (update.tag) {
    // Replace，直接用新的 state 替代原有的 state
    case ReplaceState: {
      const payload = update.payload;
      // 在使用 function 做第一个参数调用 setState，生成的 update.payload 即为这个 function
      // 下同
      if (typeof payload === 'function') {
        // Updater function
        if (__DEV__) {
          enterDisallowedContextReadInDEV();
          if (
            debugRenderPhaseSideEffects ||
            (debugRenderPhaseSideEffectsForStrictMode &&
              workInProgress.mode & StrictMode)
          ) {
            payload.call(instance, prevState, nextProps);
          }
        }
        const nextState = payload.call(instance, prevState, nextProps);
        if (__DEV__) {
          exitDisallowedContextReadInDEV();
        }
        return nextState;
      }
      // State object
      return payload;
    }
    // Capture，对对应的 fiber 打上错误捕获流程的标记
    // fiber 报错时会通过 `enqueueCapturedUpdate` 添加 Capture 类型的 update
    case CaptureUpdate: {
      // 去掉 ShouldCapture 标记，添加 DidCapture 标记
      workInProgress.effectTag =
        (workInProgress.effectTag & ~ShouldCapture) | DidCapture;
    }
    // Intentional fallthrough
    // Update，默认的 case（UpdateState 的值为 0，同样也是 tag 的默认值）
    case UpdateState: {
      const payload = update.payload;
      let partialState;
      if (typeof payload === 'function') {
        // Updater function
        if (__DEV__) {
          enterDisallowedContextReadInDEV();
          if (
            debugRenderPhaseSideEffects ||
            (debugRenderPhaseSideEffectsForStrictMode &&
              workInProgress.mode & StrictMode)
          ) {
            payload.call(instance, prevState, nextProps);
          }
        }
        partialState = payload.call(instance, prevState, nextProps);
        if (__DEV__) {
          exitDisallowedContextReadInDEV();
        }
      } else {
        // Partial state object
        partialState = payload;
      }
      if (partialState === null || partialState === undefined) {
        // Null and undefined are treated as no-ops.
        // partialState 为 null 和 undefined 将视为不对 state 进行操作
        return prevState;
      }
      // Merge the partial state and the previous state.
      // 把之前的 state 和新计算出来的这部分 state merge 起来，返回为新的 state
      return Object.assign({}, prevState, partialState);
    }
    // Force，在这里跳过了新 state 的计算
    case ForceUpdate: {
      // hasForceUpdate 具体作用参考 packages\react-reconciler\src\ReactFiberClassComponent.js
      hasForceUpdate = true;
      return prevState;
    }
  }
  return prevState;
}

export function processUpdateQueue<State>(
  workInProgress: Fiber,
  queue: UpdateQueue<State>,
  props: any,
  instance: any,
  renderExpirationTime: ExpirationTime,
): void {
  hasForceUpdate = false;

  queue = ensureWorkInProgressQueueIsAClone(workInProgress, queue);

  if (__DEV__) {
    currentlyProcessingQueue = queue;
  }

  // These values may change as we process the queue.
  // 这些值可能会随着我们处理队列的过程而改变。
  let newBaseState = queue.baseState;
  let newFirstUpdate = null;
  let newExpirationTime = NoWork;

  // Iterate through the list of updates to compute the result.
  // 遍历更新列表来计算结果。
  let update = queue.firstUpdate;
  let resultState = newBaseState;
  while (update !== null) {
    const updateExpirationTime = update.expirationTime;
    if (updateExpirationTime < renderExpirationTime) {
      // This update does not have sufficient priority. Skip it.
      // 这个 update 没有足够的优先级。跳过处理。
      if (newFirstUpdate === null) {
        // This is the first skipped update. It will be the first update in
        // the new list.
        // newFirstUpdate 为 null 代表这是整个队列里第一个被跳过的 update。
        // 也就是说这个 update 会成为新队列里的首个 update 。
        newFirstUpdate = update;
        // Since this is the first update that was skipped, the current result
        // is the new base state.
        // 由于这是第一个被跳过的 update，因此 resultState 就是新的 baseState。
        // resultState 是会随着链表的遍历而发生变化的，
        newBaseState = resultState;
      }
      // Since this update will remain in the list, update the remaining
      // expiration time.
      // 因为这个 update 还是会保留在队列中，因此更新接下来的到期时间 newExpirationTime
      //
      // 也就是说 newExpirationTime 会变成被跳过的这些 update 中 expirationTime 最大的，
      // 即优先级最高的。
      if (newExpirationTime < updateExpirationTime) {
        newExpirationTime = updateExpirationTime;
      }
    } else {
      // This update does have sufficient priority. Process it and compute
      // a new result.
      // 这个 update 拥有足够的优先级。运行 update，并计算出 state 处理的结果。
      resultState = getStateFromUpdate(
        workInProgress,
        queue,
        update,
        resultState,
        props,
        instance,
      );
      const callback = update.callback;
      if (callback !== null) {
        // 若有 callback，给 workInProgress.effectTag 加上 callback 标记
        workInProgress.effectTag |= Callback;
        // 将 update.nextEffect 设为 null，
        // 防止他在被中断的 render 期间发生变化
        // Set this to null, in case it was mutated during an aborted render.
        update.nextEffect = null;
        if (queue.lastEffect === null) {
          // 若 queue 中 effect 链表为空，把 update 当作 effect 链表的第一个节点
          queue.firstEffect = queue.lastEffect = update;
        } else {
          // 反之将这个 update 放到 effect 链表的末尾
          queue.lastEffect.nextEffect = update;
          queue.lastEffect = update;
        }
      }
    }
    // Continue to the next update.
    // 继续执行下一个 update。
    update = update.next;
  }

  // Separately, iterate though the list of captured updates.
  // 随后，遍历被捕获的 update 链表，过程和上面遍历正常 update 基本一致。
  // 当然 update 产生的 effect 会放到 effect 链表里
  let newFirstCapturedUpdate = null;
  update = queue.firstCapturedUpdate;
  while (update !== null) {
    const updateExpirationTime = update.expirationTime;
    if (updateExpirationTime < renderExpirationTime) {
      // This update does not have sufficient priority. Skip it.
      if (newFirstCapturedUpdate === null) {
        // This is the first skipped captured update. It will be the first
        // update in the new list.
        newFirstCapturedUpdate = update;
        // If this is the first update that was skipped, the current result is
        // the new base state.
        if (newFirstUpdate === null) {
          newBaseState = resultState;
        }
      }
      // Since this update will remain in the list, update the remaining
      // expiration time.
      if (newExpirationTime < updateExpirationTime) {
        newExpirationTime = updateExpirationTime;
      }
    } else {
      // This update does have sufficient priority. Process it and compute
      // a new result.
      resultState = getStateFromUpdate(
        workInProgress,
        queue,
        update,
        resultState,
        props,
        instance,
      );
      const callback = update.callback;
      if (callback !== null) {
        workInProgress.effectTag |= Callback;
        // Set this to null, in case it was mutated during an aborted render.
        update.nextEffect = null;
        if (queue.lastCapturedEffect === null) {
          queue.firstCapturedEffect = queue.lastCapturedEffect = update;
        } else {
          queue.lastCapturedEffect.nextEffect = update;
          queue.lastCapturedEffect = update;
        }
      }
    }
    update = update.next;
  }

  if (newFirstUpdate === null) {
    // 若没有被跳过的 update，则将首尾指向 null
    queue.lastUpdate = null;
  }
  if (newFirstCapturedUpdate === null) {
    // 若没有被跳过的捕获类型 update，则将首尾指向 null
    queue.lastCapturedUpdate = null;
  } else {
    // 反之，给 workInProgress.effectTag 添加 callback 标记
    workInProgress.effectTag |= Callback;
  }
  if (newFirstUpdate === null && newFirstCapturedUpdate === null) {
    // We processed every update, without skipping. That means the new base
    // state is the same as the result state.
    // 我们处理了所有的 update，且没有任何 update 被跳过。
    // 这意味着 queue 的新 baseState 应当和现在的 state 相同
    newBaseState = resultState;
  }

  // 我们假设第一个被跳过的 update 叫 updateQ
  // 综上，newBaseState 会停留在 updateQ 运行之前的 state 上，设这个 state 为 stateP，
  // queue 将从 updateQ 开始，
  // expirationTime 也会被置为被跳过的 update 中最大最优先的。
  //
  // 也就是说下一次执行这个 queue，会从 updateQ 重新开始，且还使用 stateP 做 baseState
  // TODO (itpt of Ian): 确认 skip update 是否的确如此运行
  queue.baseState = newBaseState;
  queue.firstUpdate = newFirstUpdate;
  queue.firstCapturedUpdate = newFirstCapturedUpdate;

  // Set the remaining expiration time to be whatever is remaining in the queue.
  // This should be fine because the only two other things that contribute to
  // expiration time are props and context. We're already in the middle of the
  // begin phase by the time we start processing the queue, so we've already
  // dealt with the props. Context in components that specify
  // shouldComponentUpdate is tricky; but we'll have to account for
  // that regardless.
  // 无论 queue 中的 expirationTime 为何值，
  // 这里都会将 workInProgress 的 expirationTime 设为 queue 中的 expirationTime。
  // 所以这样做是没有问题的，因为除此之外仅有 props 和 context 会影响 expirationTime。
  // 我们在开始处理队列时，就已经处于开始阶段的中间位置，所以我们已经处理过 props 了；
  // 指明 shouldComponentUpdate 中组件的 context 很棘手，但是我们依然要面对这个麻烦。
  // TODO (itpt of Ian): 指明 shouldComponentUpdate 中组件的 context 为什么很棘手？React 又是如何处理的？
  workInProgress.expirationTime = newExpirationTime;
  workInProgress.memoizedState = resultState;

  if (__DEV__) {
    currentlyProcessingQueue = null;
  }
}

function callCallback(callback, context) {
  invariant(
    typeof callback === 'function',
    'Invalid argument passed as callback. Expected a function. Instead ' +
      'received: %s',
    callback,
  );
  callback.call(context);
}

export function resetHasForceUpdateBeforeProcessing() {
  hasForceUpdate = false;
}

export function checkHasForceUpdateAfterProcessing(): boolean {
  return hasForceUpdate;
}

export function commitUpdateQueue<State>(
  finishedWork: Fiber,
  finishedQueue: UpdateQueue<State>,
  instance: any,
  renderExpirationTime: ExpirationTime,
): void {
  // If the finished render included captured updates, and there are still
  // lower priority updates left over, we need to keep the captured updates
  // in the queue so that they are rebased and not dropped once we process the
  // queue again at the lower priority.
  //
  // 如果刚才结束的 render 过程包括了被捕获的 update，且这里任然有低优先级的 update 没被执行，
  // 我们需要保留这些错误捕获相关的 update，这样能确保低优先级 update 执行时，我们不会遗漏这些
  // 错误捕获 update。
  if (finishedQueue.firstCapturedUpdate !== null) {
    // Join the captured update list to the end of the normal list.
    if (finishedQueue.lastUpdate !== null) {
      finishedQueue.lastUpdate.next = finishedQueue.firstCapturedUpdate;
      finishedQueue.lastUpdate = finishedQueue.lastCapturedUpdate;
    }
    // Clear the list of captured updates.
    finishedQueue.firstCapturedUpdate = finishedQueue.lastCapturedUpdate = null;
  }

  // Commit the effects
  commitUpdateEffects(finishedQueue.firstEffect, instance);
  finishedQueue.firstEffect = finishedQueue.lastEffect = null;

  commitUpdateEffects(finishedQueue.firstCapturedEffect, instance);
  finishedQueue.firstCapturedEffect = finishedQueue.lastCapturedEffect = null;
}

function commitUpdateEffects<State>(
  effect: Update<State> | null,
  instance: any,
): void {
  while (effect !== null) {
    const callback = effect.callback;
    if (callback !== null) {
      effect.callback = null;
      callCallback(callback, instance);
    }
    effect = effect.nextEffect;
  }
}
