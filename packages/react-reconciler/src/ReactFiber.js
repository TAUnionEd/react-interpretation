/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactElement, Source} from 'shared/ReactElementType';
import type {ReactFragment, ReactPortal, RefObject} from 'shared/ReactTypes';
import type {WorkTag} from 'shared/ReactWorkTags';
import type {TypeOfMode} from './ReactTypeOfMode';
import type {SideEffectTag} from 'shared/ReactSideEffectTags';
import type {ExpirationTime} from './ReactFiberExpirationTime';
import type {UpdateQueue} from './ReactUpdateQueue';
import type {ContextDependencyList} from './ReactFiberNewContext';
import type {HookType} from './ReactFiberHooks';

import invariant from 'shared/invariant';
import warningWithoutStack from 'shared/warningWithoutStack';
import {enableProfilerTimer} from 'shared/ReactFeatureFlags';
import {NoEffect} from 'shared/ReactSideEffectTags';
import {
  IndeterminateComponent,
  ClassComponent,
  HostRoot,
  HostComponent,
  HostText,
  HostPortal,
  ForwardRef,
  Fragment,
  Mode,
  ContextProvider,
  ContextConsumer,
  Profiler,
  SuspenseComponent,
  FunctionComponent,
  MemoComponent,
  LazyComponent,
} from 'shared/ReactWorkTags';
import getComponentName from 'shared/getComponentName';

import {isDevToolsPresent} from './ReactFiberDevToolsHook';
import {NoWork} from './ReactFiberExpirationTime';
import {
  NoContext,
  ConcurrentMode,
  ProfileMode,
  StrictMode,
} from './ReactTypeOfMode';
import {
  REACT_FORWARD_REF_TYPE,
  REACT_FRAGMENT_TYPE,
  REACT_STRICT_MODE_TYPE,
  REACT_PROFILER_TYPE,
  REACT_PROVIDER_TYPE,
  REACT_CONTEXT_TYPE,
  REACT_CONCURRENT_MODE_TYPE,
  REACT_SUSPENSE_TYPE,
  REACT_MEMO_TYPE,
  REACT_LAZY_TYPE,
} from 'shared/ReactSymbols';

let hasBadMapPolyfill;

if (__DEV__) {
  hasBadMapPolyfill = false;
  try {
    const nonExtensibleObject = Object.preventExtensions({});
    const testMap = new Map([[nonExtensibleObject, null]]);
    const testSet = new Set([nonExtensibleObject]);
    // This is necessary for Rollup to not consider these unused.
    // https://github.com/rollup/rollup/issues/1771
    // TODO: we can remove these if Rollup fixes the bug.
    testMap.set(0, 0);
    testSet.add(0);
  } catch (e) {
    // TODO: Consider warning about bad polyfills
    hasBadMapPolyfill = true;
  }
}

// A Fiber is work on a Component that needs to be done or was done. There can
// be more than one per component.
// Fiber 作用于需要完成或者已完成的组件上。一个组件可能有多个 Fiber。
export type Fiber = {|
  // These first fields are conceptually members of an Instance. This used to
  // be split into a separate type and intersected with the other Fiber fields,
  // but until Flow fixes its intersection bugs, we've merged them into a
  // single type.
  //
  // 最前面列出的这些字段（tag, key, elementType, type & stateNode）在概念上应当是属于另一个单独的实例。
  // 这些字段之前被抽象成一个单独的 type，然后再与其他 Fiber 的字段同级的放在一起。
  // 大概是这个意思：type Fiber = {
  //    Instance: { tag, key, elementType, type, stateNode },
  //    return,
  //    child,
  //    ...
  // }
  // 但是在 Flow 把交叉类型（intersection type）有关的 bug 修好前，我们不会把这些字段单独抽成一个 type。

  // An Instance is shared between all versions of a component. We can easily
  // break this out into a separate object to avoid copying so much to the
  // alternate versions of the tree. We put this on a single object for now to
  // minimize the number of objects created during the initial render.
  //
  // 这些字段组成的实例应当会被所有版本的组件所共享。
  // 我们可以简单的把他分离出来，以免在 fiber tree 的轮转版本中复制太多次。
  // 把这些字段抽成单独的对象，也可以将最初的 render 时创建的对象数量降到最低。

  // 总之就是他们想抽出来但是没抽成……

  // Tag identifying the type of fiber.
  // tag 标记了 fiber 的类型。或者说标记了这个 fiber 相关的组件的类型。
  tag: WorkTag,

  // Unique identifier of this child.
  // 此节点在子节点意义下的唯一标识。和 element.key 类似，这个 key 用于区分他和他的兄弟节点们。
  key: null | string,

  // The value of element.type which is used to preserve the identity during
  // reconciliation of this child.
  // ReactElement.type 的值，用于调和（reconciliation）过程中保存此子节点的本征。
  elementType: any,

  // The resolved function/class/ associated with this fiber.
  // 此 fiber 相关的 function 或 class 处理之后的值。
  // TODO (itpt of Ian): resolve 是指什么过程？为什么从代码上看 elementType 与 type 一直是相等的？
  type: any,

  // The local state associated with this fiber.
  // 此 fiber 相关的本地状态。一般是 fiber 对应的 DOM 实例。
  // 特别的，ReactRoot 对应的 fiber 其 stateNode 是 FiberRoot。
  stateNode: any,

  // Conceptual aliases
  // parent : Instance -> return The parent happens to be the same as the
  // return fiber since we've merged the fiber and instance.
  //
  // 概念上的别名
  // parent: Instance 别称 return
  // 由于我们把 Fiber 和这个应当抽象出来的 Instance 合并了，所以 parent 和 return 这俩字段现在是一样的。

  // Remaining fields belong to Fiber
  // 剩下的字段是属于 Fiber 的

  // The Fiber to return to after finishing processing this one.
  // This is effectively the parent, but there can be multiple parents (two)
  // so this is only the parent of the thing we're currently processing.
  // It is conceptually the same as the return address of a stack frame.
  //
  // 当前 fiber 处理流程结束后回到的 fiber 节点。
  // 实际上就是这个 fiber 节点的父节点，但是在整个流程上这个节点有可能有多个（两个）父节点
  //（我猜是指 fiber tree 变化前后父节点也有可能变化），故这里的 return 只指我们正在处理的这个场景下的父节点。
  // 从概念上来说，他和在栈处理时，当前节点将会返回的那个节点是一致的。
  //（也就是说 Fiber Reconciler 中节点的父子关系和 Stack Reconciler 中节点的父子关系在概念上是一样的）
  return: Fiber | null,

  // Singly Linked List Tree Structure.
  // 单链表树状结构
  child: Fiber | null,
  sibling: Fiber | null,
  index: number,

  // The ref last used to attach this node.
  // I'll avoid adding an owner field for prod and model that as functions.
  // 最终用于添加到这个节点上的 ref。
  // 这里建议传 function 进来计算 ref。
  ref: null | (((handle: mixed) => void) & {_stringRef: ?string}) | RefObject,

  // Input is the data coming into process this fiber. Arguments. Props.
  // 处理过程中输入 fiber 的数据，其实就是 element.props
  // This type will be more specific once we overload the tag.
  // 一但我们载入了 tag，props 的类型就会被具体的定义
  pendingProps: any,  // 当前处理过程中组件的 props
  memoizedProps: any, // 已经用于输出的 props，即上一次处理完成之后的 props

  // A queue of state updates and callbacks.
  // 一个 state 更新和回调的队列
  // 详情见 packages\react-reconciler\src\ReactUpdateQueue.js
  updateQueue: UpdateQueue<any> | null,

  // The state used to create the output
  // 已经用于输出的 state，即上一次处理完成之后的 state
  memoizedState: any,

  // A linked-list of contexts that this fiber depends on
  // 这个 fiber 所依赖的上下文链表
  contextDependencies: ContextDependencyList | null,

  // Bitfield that describes properties about the fiber and its subtree. E.g.
  // the ConcurrentMode flag indicates whether the subtree should be async-by-
  // default. When a fiber is created, it inherits the mode of its
  // parent. Additional flags can be set at creation time, but after that the
  // value should remain unchanged throughout the fiber's lifetime, particularly
  // before its child fibers are created.
  //
  // 一个用来描述 fiber 和其子树的位段属性。比如说，ConcurrentMode 位标记控制其子树是否
  // 是默认异步的。当一个 fiber 被创建时，他将会从他的父节点那里继承 mode 字段。可以在创建
  // 阶段操作这些位标记，但是在此之后 fiber 的整个生命周期里，尤其在他的子节点创建之前，
  // mode 字段都不能再改变了。
  // TypeOfMode 参见 packages\react-reconciler\src\ReactTypeOfMode.js
  mode: TypeOfMode,

  // Effect
  // 功能标记。标记着这个 fiber 将要对 host 元素（即 DOM）或者 element 做什么操作。
  // 详情见 packages\shared\ReactSideEffectTags.js
  // 从中可以发现这些操作包括更新 DOM 树，调用组件生命周期，更新 ref 等操作。
  // 同样是一个位段。意味着这里可以同时记录多个 effect。
  effectTag: SideEffectTag,

  // Singly linked list fast path to the next fiber with side-effects.
  // 单链表，用来快速定位下一个有副作用操作的 fiber
  nextEffect: Fiber | null,

  // The first and last fiber with side-effect within this subtree. This allows
  // us to reuse a slice of the linked list when we reuse the work done within
  // this fiber.
  // 子树中第一个和最后一个具有副作用的 fiber。记录首尾可以让我们在复用当前 fiber 所作的工作时，
  // 复用相应的 effect 链表。
  //
  // 在整个 fiber tree 创建过程中，Fiber Reconciler 会尽量复用 fiber。
  // fiber 复用的逻辑参见：
  // packages\react-reconciler\src\ReactChildFiber.js#L733 @reconcileChildrenArray
  firstEffect: Fiber | null,
  lastEffect: Fiber | null,

  // Represents a time in the future by which this work should be completed.
  // Does not include work found in its subtree.
  // 代表着当前任务会在未来的什么时候完成。
  // 不包括子树中发现的任务。
  // 计算方法见 packages\react-reconciler\src\ReactFiberScheduler.js#1595 @computeExpirationForFiber
  expirationTime: ExpirationTime,

  // This is used to quickly determine if a subtree has no pending changes.
  // 用于快速确定子树是否含有等待中的变更。
  // 若 childExpirationTime >= expirationTime，则显然子树是有变更的。
  // 若无变更 childExpirationTime 一般会为 Sync 或 NoWork
  childExpirationTime: ExpirationTime,

  // This is a pooled version of a Fiber. Every fiber that gets updated will
  // eventually have a pair. There are cases when we can clean up pairs to save
  // memory if we need to.
  // 这是 fiber 的一个副本。每一个 fiber。每一个会更新的 fiber 都会有一个副本与之对应。
  // 某些情况下如有必要减少内存消耗，我们会清理这些副本。
  //
  // fiber 与 workInProgress 互相持有 alternate 引用
  // alternate 的创建参见下文 @createWorkInProgress
  alternate: Fiber | null,

  // Conceptual aliases
  // workInProgress : Fiber ->  alternate The alternate used for reuse happens
  // to be the same as work in progress.
  // 概念上的别名
  // workInProgress: Fiber 别称 alternate
  // 用于复用的字段 alternate 与 workInProgress 相同。

  // 以下四个字段都仅与 profile 有关，忽略

  // Time spent rendering this Fiber and its descendants for the current update.
  // This tells us how well the tree makes use of sCU for memoization.
  // It is reset to 0 each time we render and only updated when we don't bailout.
  // This field is only set when the enableProfilerTimer flag is enabled.
  actualDuration?: number,

  // If the Fiber is currently active in the "render" phase,
  // This marks the time at which the work began.
  // This field is only set when the enableProfilerTimer flag is enabled.
  actualStartTime?: number,

  // Duration of the most recent render time for this Fiber.
  // This value is not updated when we bailout for memoization purposes.
  // This field is only set when the enableProfilerTimer flag is enabled.
  selfBaseDuration?: number,

  // Sum of base times for all descedents of this Fiber.
  // This value bubbles up during the "complete" phase.
  // This field is only set when the enableProfilerTimer flag is enabled.
  treeBaseDuration?: number,

  // __DEV__ only
  _debugID?: number,
  _debugSource?: Source | null,
  _debugOwner?: Fiber | null,
  _debugIsCurrentlyTiming?: boolean,

  // Used to verify that the order of hooks does not change between renders.
  _debugHookTypes?: Array<HookType> | null,
|};

let debugCounter;

if (__DEV__) {
  debugCounter = 1;
}

function FiberNode(
  tag: WorkTag,
  pendingProps: mixed,
  key: null | string,
  mode: TypeOfMode,
) {
  // Instance
  this.tag = tag;
  this.key = key;
  this.elementType = null;
  this.type = null;
  this.stateNode = null;

  // Fiber
  this.return = null;
  this.child = null;
  this.sibling = null;
  this.index = 0;

  this.ref = null;

  this.pendingProps = pendingProps;
  this.memoizedProps = null;
  this.updateQueue = null;
  this.memoizedState = null;
  this.contextDependencies = null;

  this.mode = mode;

  // Effects
  this.effectTag = NoEffect;
  this.nextEffect = null;

  this.firstEffect = null;
  this.lastEffect = null;

  this.expirationTime = NoWork;
  this.childExpirationTime = NoWork;

  this.alternate = null;

  if (enableProfilerTimer) {
    // Note: The following is done to avoid a v8 performance cliff.
    //
    // Initializing the fields below to smis and later updating them with
    // double values will cause Fibers to end up having separate shapes.
    // This behavior/bug has something to do with Object.preventExtension().
    // Fortunately this only impacts DEV builds.
    // Unfortunately it makes React unusably slow for some applications.
    // To work around this, initialize the fields below with doubles.
    //
    // Learn more about this here:
    // https://github.com/facebook/react/issues/14365
    // https://bugs.chromium.org/p/v8/issues/detail?id=8538
    this.actualDuration = Number.NaN;
    this.actualStartTime = Number.NaN;
    this.selfBaseDuration = Number.NaN;
    this.treeBaseDuration = Number.NaN;

    // It's okay to replace the initial doubles with smis after initialization.
    // This won't trigger the performance cliff mentioned above,
    // and it simplifies other profiler code (including DevTools).
    this.actualDuration = 0;
    this.actualStartTime = -1;
    this.selfBaseDuration = 0;
    this.treeBaseDuration = 0;
  }

  if (__DEV__) {
    this._debugID = debugCounter++;
    this._debugSource = null;
    this._debugOwner = null;
    this._debugIsCurrentlyTiming = false;
    this._debugHookTypes = null;
    if (!hasBadMapPolyfill && typeof Object.preventExtensions === 'function') {
      Object.preventExtensions(this);
    }
  }
}

// This is a constructor function, rather than a POJO constructor, still
// please ensure we do the following:
// 1) Nobody should add any instance methods on this. Instance methods can be
//    more difficult to predict when they get optimized and they are almost
//    never inlined properly in static compilers.
// 2) Nobody should rely on `instanceof Fiber` for type testing. We should
//    always know when it is a fiber.
// 3) We might want to experiment with using numeric keys since they are easier
//    to optimize in a non-JIT environment.
// 4) We can easily go from a constructor to a createFiber object literal if that
//    is faster.
// 5) It should be easy to port this to a C struct and keep a C implementation
//    compatible.
const createFiber = function(
  tag: WorkTag,
  pendingProps: mixed,
  key: null | string,
  mode: TypeOfMode,
): Fiber {
  // $FlowFixMe: the shapes are exact here but Flow doesn't like constructors
  return new FiberNode(tag, pendingProps, key, mode);
};

function shouldConstruct(Component: Function) {
  const prototype = Component.prototype;
  return !!(prototype && prototype.isReactComponent);
}

export function isSimpleFunctionComponent(type: any) {
  return (
    typeof type === 'function' &&
    !shouldConstruct(type) &&
    type.defaultProps === undefined
  );
}

export function resolveLazyComponentTag(Component: Function): WorkTag {
  if (typeof Component === 'function') {
    return shouldConstruct(Component) ? ClassComponent : FunctionComponent;
  } else if (Component !== undefined && Component !== null) {
    const $$typeof = Component.$$typeof;
    if ($$typeof === REACT_FORWARD_REF_TYPE) {
      return ForwardRef;
    }
    if ($$typeof === REACT_MEMO_TYPE) {
      return MemoComponent;
    }
  }
  return IndeterminateComponent;
}

// This is used to create an alternate fiber to do work on.
export function createWorkInProgress(
  current: Fiber,
  pendingProps: any,
  expirationTime: ExpirationTime,
): Fiber {
  let workInProgress = current.alternate;
  if (workInProgress === null) {
    // We use a double buffering pooling technique because we know that we'll
    // only ever need at most two versions of a tree. We pool the "other" unused
    // node that we're free to reuse. This is lazily created to avoid allocating
    // extra objects for things that are never updated. It also allow us to
    // reclaim the extra memory if needed.
    workInProgress = createFiber(
      current.tag,
      pendingProps,
      current.key,
      current.mode,
    );
    workInProgress.elementType = current.elementType;
    workInProgress.type = current.type;
    workInProgress.stateNode = current.stateNode;

    if (__DEV__) {
      // DEV-only fields
      workInProgress._debugID = current._debugID;
      workInProgress._debugSource = current._debugSource;
      workInProgress._debugOwner = current._debugOwner;
      workInProgress._debugHookTypes = current._debugHookTypes;
    }

    workInProgress.alternate = current;
    current.alternate = workInProgress;
  } else {
    workInProgress.pendingProps = pendingProps;

    // We already have an alternate.
    // Reset the effect tag.
    workInProgress.effectTag = NoEffect;

    // The effect list is no longer valid.
    workInProgress.nextEffect = null;
    workInProgress.firstEffect = null;
    workInProgress.lastEffect = null;

    if (enableProfilerTimer) {
      // We intentionally reset, rather than copy, actualDuration & actualStartTime.
      // This prevents time from endlessly accumulating in new commits.
      // This has the downside of resetting values for different priority renders,
      // But works for yielding (the common case) and should support resuming.
      workInProgress.actualDuration = 0;
      workInProgress.actualStartTime = -1;
    }
  }

  workInProgress.childExpirationTime = current.childExpirationTime;
  workInProgress.expirationTime = current.expirationTime;

  workInProgress.child = current.child;
  workInProgress.memoizedProps = current.memoizedProps;
  workInProgress.memoizedState = current.memoizedState;
  workInProgress.updateQueue = current.updateQueue;
  workInProgress.contextDependencies = current.contextDependencies;

  // These will be overridden during the parent's reconciliation
  workInProgress.sibling = current.sibling;
  workInProgress.index = current.index;
  workInProgress.ref = current.ref;

  if (enableProfilerTimer) {
    workInProgress.selfBaseDuration = current.selfBaseDuration;
    workInProgress.treeBaseDuration = current.treeBaseDuration;
  }

  return workInProgress;
}

export function createHostRootFiber(isConcurrent: boolean): Fiber {
  // 若是并行操作生成 Root Fiber，则记为“并行+严格”模式，否则不做限制
  let mode = isConcurrent ? ConcurrentMode | StrictMode : NoContext;

  // 开启 profiler 才会有功能，忽略
  if (enableProfilerTimer && isDevToolsPresent) {
    // Always collect profile timings when DevTools are present.
    // This enables DevTools to start capturing timing at any point–
    // Without some nodes in the tree having empty base times.
    mode |= ProfileMode;
  }

  // HostRoot，ReactWorkTag 中的一种。ReactWorkTag 用来描述这个 fiber 是用来处理什么任务的。
  return createFiber(HostRoot, null, null, mode);
}

export function createFiberFromTypeAndProps(
  type: any, // React$ElementType
  key: null | string,
  pendingProps: any,
  owner: null | Fiber,
  mode: TypeOfMode,
  expirationTime: ExpirationTime,
): Fiber {
  let fiber;

  let fiberTag = IndeterminateComponent;
  // The resolved type is set if we know what the final type will be. I.e. it's not lazy.
  let resolvedType = type;
  if (typeof type === 'function') {
    if (shouldConstruct(type)) {
      fiberTag = ClassComponent;
    }
  } else if (typeof type === 'string') {
    fiberTag = HostComponent;
  } else {
    getTag: switch (type) {
      case REACT_FRAGMENT_TYPE:
        return createFiberFromFragment(
          pendingProps.children,
          mode,
          expirationTime,
          key,
        );
      case REACT_CONCURRENT_MODE_TYPE:
        return createFiberFromMode(
          pendingProps,
          mode | ConcurrentMode | StrictMode,
          expirationTime,
          key,
        );
      case REACT_STRICT_MODE_TYPE:
        return createFiberFromMode(
          pendingProps,
          mode | StrictMode,
          expirationTime,
          key,
        );
      case REACT_PROFILER_TYPE:
        return createFiberFromProfiler(pendingProps, mode, expirationTime, key);
      case REACT_SUSPENSE_TYPE:
        return createFiberFromSuspense(pendingProps, mode, expirationTime, key);
      default: {
        if (typeof type === 'object' && type !== null) {
          switch (type.$$typeof) {
            case REACT_PROVIDER_TYPE:
              fiberTag = ContextProvider;
              break getTag;
            case REACT_CONTEXT_TYPE:
              // This is a consumer
              fiberTag = ContextConsumer;
              break getTag;
            case REACT_FORWARD_REF_TYPE:
              fiberTag = ForwardRef;
              break getTag;
            case REACT_MEMO_TYPE:
              fiberTag = MemoComponent;
              break getTag;
            case REACT_LAZY_TYPE:
              fiberTag = LazyComponent;
              resolvedType = null;
              break getTag;
          }
        }
        let info = '';
        if (__DEV__) {
          if (
            type === undefined ||
            (typeof type === 'object' &&
              type !== null &&
              Object.keys(type).length === 0)
          ) {
            info +=
              ' You likely forgot to export your component from the file ' +
              "it's defined in, or you might have mixed up default and " +
              'named imports.';
          }
          const ownerName = owner ? getComponentName(owner.type) : null;
          if (ownerName) {
            info += '\n\nCheck the render method of `' + ownerName + '`.';
          }
        }
        invariant(
          false,
          'Element type is invalid: expected a string (for built-in ' +
            'components) or a class/function (for composite components) ' +
            'but got: %s.%s',
          type == null ? type : typeof type,
          info,
        );
      }
    }
  }

  fiber = createFiber(fiberTag, pendingProps, key, mode);
  fiber.elementType = type;
  fiber.type = resolvedType;
  fiber.expirationTime = expirationTime;

  return fiber;
}

export function createFiberFromElement(
  element: ReactElement,
  mode: TypeOfMode,
  expirationTime: ExpirationTime,
): Fiber {
  let owner = null;
  if (__DEV__) {
    owner = element._owner;
  }
  const type = element.type;
  const key = element.key;
  const pendingProps = element.props;
  const fiber = createFiberFromTypeAndProps(
    type,
    key,
    pendingProps,
    owner,
    mode,
    expirationTime,
  );
  if (__DEV__) {
    fiber._debugSource = element._source;
    fiber._debugOwner = element._owner;
  }
  return fiber;
}

export function createFiberFromFragment(
  elements: ReactFragment,
  mode: TypeOfMode,
  expirationTime: ExpirationTime,
  key: null | string,
): Fiber {
  const fiber = createFiber(Fragment, elements, key, mode);
  fiber.expirationTime = expirationTime;
  return fiber;
}

function createFiberFromProfiler(
  pendingProps: any,
  mode: TypeOfMode,
  expirationTime: ExpirationTime,
  key: null | string,
): Fiber {
  if (__DEV__) {
    if (
      typeof pendingProps.id !== 'string' ||
      typeof pendingProps.onRender !== 'function'
    ) {
      warningWithoutStack(
        false,
        'Profiler must specify an "id" string and "onRender" function as props',
      );
    }
  }

  const fiber = createFiber(Profiler, pendingProps, key, mode | ProfileMode);
  // TODO: The Profiler fiber shouldn't have a type. It has a tag.
  fiber.elementType = REACT_PROFILER_TYPE;
  fiber.type = REACT_PROFILER_TYPE;
  fiber.expirationTime = expirationTime;

  return fiber;
}

function createFiberFromMode(
  pendingProps: any,
  mode: TypeOfMode,
  expirationTime: ExpirationTime,
  key: null | string,
): Fiber {
  const fiber = createFiber(Mode, pendingProps, key, mode);

  // TODO: The Mode fiber shouldn't have a type. It has a tag.
  const type =
    (mode & ConcurrentMode) === NoContext
      ? REACT_STRICT_MODE_TYPE
      : REACT_CONCURRENT_MODE_TYPE;
  fiber.elementType = type;
  fiber.type = type;

  fiber.expirationTime = expirationTime;
  return fiber;
}

export function createFiberFromSuspense(
  pendingProps: any,
  mode: TypeOfMode,
  expirationTime: ExpirationTime,
  key: null | string,
) {
  const fiber = createFiber(SuspenseComponent, pendingProps, key, mode);

  // TODO: The SuspenseComponent fiber shouldn't have a type. It has a tag.
  const type = REACT_SUSPENSE_TYPE;
  fiber.elementType = type;
  fiber.type = type;

  fiber.expirationTime = expirationTime;
  return fiber;
}

export function createFiberFromText(
  content: string,
  mode: TypeOfMode,
  expirationTime: ExpirationTime,
): Fiber {
  const fiber = createFiber(HostText, content, null, mode);
  fiber.expirationTime = expirationTime;
  return fiber;
}

export function createFiberFromHostInstanceForDeletion(): Fiber {
  const fiber = createFiber(HostComponent, null, null, NoContext);
  // TODO: These should not need a type.
  fiber.elementType = 'DELETED';
  fiber.type = 'DELETED';
  return fiber;
}

export function createFiberFromPortal(
  portal: ReactPortal,
  mode: TypeOfMode,
  expirationTime: ExpirationTime,
): Fiber {
  const pendingProps = portal.children !== null ? portal.children : [];
  const fiber = createFiber(HostPortal, pendingProps, portal.key, mode);
  fiber.expirationTime = expirationTime;
  fiber.stateNode = {
    containerInfo: portal.containerInfo,
    pendingChildren: null, // Used by persistent updates
    implementation: portal.implementation,
  };
  return fiber;
}

// Used for stashing WIP properties to replay failed work in DEV.
export function assignFiberPropertiesInDEV(
  target: Fiber | null,
  source: Fiber,
): Fiber {
  if (target === null) {
    // This Fiber's initial properties will always be overwritten.
    // We only use a Fiber to ensure the same hidden class so DEV isn't slow.
    target = createFiber(IndeterminateComponent, null, null, NoContext);
  }

  // This is intentionally written as a list of all properties.
  // We tried to use Object.assign() instead but this is called in
  // the hottest path, and Object.assign() was too slow:
  // https://github.com/facebook/react/issues/12502
  // This code is DEV-only so size is not a concern.

  target.tag = source.tag;
  target.key = source.key;
  target.elementType = source.elementType;
  target.type = source.type;
  target.stateNode = source.stateNode;
  target.return = source.return;
  target.child = source.child;
  target.sibling = source.sibling;
  target.index = source.index;
  target.ref = source.ref;
  target.pendingProps = source.pendingProps;
  target.memoizedProps = source.memoizedProps;
  target.updateQueue = source.updateQueue;
  target.memoizedState = source.memoizedState;
  target.contextDependencies = source.contextDependencies;
  target.mode = source.mode;
  target.effectTag = source.effectTag;
  target.nextEffect = source.nextEffect;
  target.firstEffect = source.firstEffect;
  target.lastEffect = source.lastEffect;
  target.expirationTime = source.expirationTime;
  target.childExpirationTime = source.childExpirationTime;
  target.alternate = source.alternate;
  if (enableProfilerTimer) {
    target.actualDuration = source.actualDuration;
    target.actualStartTime = source.actualStartTime;
    target.selfBaseDuration = source.selfBaseDuration;
    target.treeBaseDuration = source.treeBaseDuration;
  }
  target._debugID = source._debugID;
  target._debugSource = source._debugSource;
  target._debugOwner = source._debugOwner;
  target._debugIsCurrentlyTiming = source._debugIsCurrentlyTiming;
  target._debugHookTypes = source._debugHookTypes;
  return target;
}
