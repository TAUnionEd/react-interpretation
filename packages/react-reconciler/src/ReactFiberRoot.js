/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactFiber';
import type {ExpirationTime} from './ReactFiberExpirationTime';
import type {TimeoutHandle, NoTimeout} from './ReactFiberHostConfig';
import type {Thenable} from './ReactFiberScheduler';
import type {Interaction} from 'scheduler/src/Tracing';

import {noTimeout} from './ReactFiberHostConfig';
import {createHostRootFiber} from './ReactFiber';
import {NoWork} from './ReactFiberExpirationTime';
import {enableSchedulerTracing} from 'shared/ReactFeatureFlags';
import {unstable_getThreadID} from 'scheduler/tracing';

// TODO: This should be lifted into the renderer.
export type Batch = {
  _defer: boolean,
  _expirationTime: ExpirationTime,
  _onComplete: () => mixed,
  _next: Batch | null,
};

export type PendingInteractionMap = Map<ExpirationTime, Set<Interaction>>;

type BaseFiberRootProperties = {
  // Any additional information from the host associated with this root.
  // 任何和这个根节点有关的宿主对象有关的信息
  // 在这里就是我们传入的 rootContainer，后续可能会在这个 DOM 上增加其他属性
  containerInfo: any,
  // Used only by persistent updates.
  // 仅在持续更新中使用，在 react-dom 中不会用到
  // TODO (itpt of Ian): what is persistent and mutation update mean in React?
  pendingChildren: any,
  // The currently active root fiber. This is the mutable root of the tree.
  // 当前活动的 FiberNode，即为正在处理的 FiberNode。
  //
  // 这里强调所谓 root，我的理解是：
  // 因为 FiberNode 有三个方向 return、child 和 sibling，使得我们不论从哪一个节点出发，
  // 都可以找到一个有向树使我们能遍历整个 fiber tree。
  // current 会随着 Fiber 的处理流程而不断移动，但不论移动到哪里，
  // current 指向的 FiberNode 都有能力当整个 fiber tree 的 root。
  current: Fiber,

  // The following priority levels are used to distinguish between 1)
  // uncommitted work, 2) uncommitted work that is suspended, and 3) uncommitted
  // work that may be unsuspended. We choose not to track each individual
  // pending level, trading granularity for performance.
  //
  // 以下几种优先级是用来区分：
  // 1) 未提交的任务
  // 2) 未提交且被挂起的任务
  // 3) 未提交且可能被挂起的任务
  // 我们选择不把每一种阻塞等级（pending level）单独划分出来, 用粒度的损失换取更好的性能
  //
  // The earliest and latest priority levels that are suspended from committing.
  //
  earliestSuspendedTime: ExpirationTime,
  latestSuspendedTime: ExpirationTime,
  // The earliest and latest priority levels that are not known to be suspended.
  earliestPendingTime: ExpirationTime,
  latestPendingTime: ExpirationTime,
  // The latest priority level that was pinged by a resolved promise and can
  // be retried.
  latestPingedTime: ExpirationTime,

  pingCache:
    | WeakMap<Thenable, Set<ExpirationTime>>
    | Map<Thenable, Set<ExpirationTime>>
    | null,

  // If an error is thrown, and there are no more updates in the queue, we try
  // rendering from the root one more time, synchronously, before handling
  // the error.
  didError: boolean,

  pendingCommitExpirationTime: ExpirationTime,
  // A finished work-in-progress HostRoot that's ready to be committed.
  finishedWork: Fiber | null,
  // Timeout handle returned by setTimeout. Used to cancel a pending timeout, if
  // it's superseded by a new one.
  timeoutHandle: TimeoutHandle | NoTimeout,
  // Top context object, used by renderSubtreeIntoContainer
  context: Object | null,
  pendingContext: Object | null,
  // Determines if we should attempt to hydrate on the initial mount
  +hydrate: boolean,
  // Remaining expiration time on this root.
  // TODO: Lift this into the renderer
  nextExpirationTimeToWorkOn: ExpirationTime,
  expirationTime: ExpirationTime,
  // List of top-level batches. This list indicates whether a commit should be
  // deferred. Also contains completion callbacks.
  // TODO: Lift this into the renderer
  firstBatch: Batch | null,
  // Linked-list of roots
  nextScheduledRoot: FiberRoot | null,
|};

// The following attributes are only used by interaction tracing builds.
// They enable interactions to be associated with their async work,
// And expose interaction metadata to the React DevTools Profiler plugin.
// Note that these attributes are only defined when the enableSchedulerTracing flag is enabled.
type ProfilingOnlyFiberRootProperties = {|
  interactionThreadID: number,
  memoizedInteractions: Set<Interaction>,
  pendingInteractionMap: PendingInteractionMap,
|};

// Exported FiberRoot type includes all properties,
// To avoid requiring potentially error-prone :any casts throughout the project.
// Profiling properties are only safe to access in profiling builds (when enableSchedulerTracing is true).
// The types are defined separately within this file to ensure they stay in sync.
// (We don't have to use an inline :any cast when enableSchedulerTracing is disabled.)
export type FiberRoot = {
  ...BaseFiberRootProperties,
  ...ProfilingOnlyFiberRootProperties,
};

export function createFiberRoot(
  containerInfo: any,
  isConcurrent: boolean,
  hydrate: boolean,
): FiberRoot {
  // { containerInfo: DOMInstance $('#root'), isConcurrent: flase, hydrate: false }
  //
  // Cyclic construction. This cheats the type system right now because
  // stateNode is any.
  //
  // 新建一个“未初始化的”、处理宿主根节点的 Fiber。
  // Fiber 是什么参见 packages\react-reconciler\src\ReactFiber.js#L87
  // 这里的宿主指 DOM，也可能是 native 组件等等。
  // 实际上 Reconciler 并不关心宿主具体是什么，甚至不关心 ReactRoot 具体是什么，
  // 以达到逻辑分层的目的。
  const uninitializedFiber = createHostRootFiber(isConcurrent);

  let root;
  // 这里的全局 flag enableSchedulerTracing 用于标识目前是否正在进行 profiling （性能分析），
  // 若正在进行 profiling 则会初始化 ProfilingOnlyFiberRootProperties 内申明的属性。
  // 有关 profiling 可以参阅 https://zh-hans.reactjs.org/docs/optimizing-performance.html#profiling-components-with-the-devtools-profiler
  // 这里先忽略 profiling 的情况。
  if (enableSchedulerTracing) {
    root = ({
      current: uninitializedFiber,
      containerInfo: containerInfo,
      pendingChildren: null,

      earliestPendingTime: NoWork,
      latestPendingTime: NoWork,
      earliestSuspendedTime: NoWork,
      latestSuspendedTime: NoWork,
      latestPingedTime: NoWork,

      pingCache: null,

      didError: false,

      pendingCommitExpirationTime: NoWork,
      finishedWork: null,
      timeoutHandle: noTimeout,
      context: null,
      pendingContext: null,
      hydrate,
      nextExpirationTimeToWorkOn: NoWork,
      expirationTime: NoWork,
      firstBatch: null,
      nextScheduledRoot: null,

      interactionThreadID: unstable_getThreadID(),
      memoizedInteractions: new Set(),
      pendingInteractionMap: new Map(),
    }: FiberRoot);
  } else {
    root = ({
      current: uninitializedFiber,
      containerInfo: containerInfo,
      pendingChildren: null,

      pingCache: null,

      earliestPendingTime: NoWork,
      latestPendingTime: NoWork,
      earliestSuspendedTime: NoWork,
      latestSuspendedTime: NoWork,
      latestPingedTime: NoWork,

      didError: false,

      pendingCommitExpirationTime: NoWork,
      finishedWork: null,
      timeoutHandle: noTimeout,
      context: null,
      pendingContext: null,
      hydrate,
      nextExpirationTimeToWorkOn: NoWork,
      expirationTime: NoWork,
      firstBatch: null,
      nextScheduledRoot: null,
    }: BaseFiberRootProperties);
  }

  // 将 root.current.stateNode 指向 root 本身
  uninitializedFiber.stateNode = root;

  // The reason for the way the Flow types are structured in this file,
  // Is to avoid needing :any casts everywhere interaction tracing fields are used.
  // Unfortunately that requires an :any cast for non-interaction tracing capable builds.
  // $FlowFixMe Remove this :any cast and replace it with something better.
  return ((root: any): FiberRoot);
}
