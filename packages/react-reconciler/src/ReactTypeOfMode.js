/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

export type TypeOfMode = number;

// 典型的权限控制位段变量，有助于清晰的构造多种模式混合的变量。
// 例如 0b111 就代表 Concurrent + Strict + Profile 模式，
// 且可通过 ConcurrentMode | StrictMode | ProfileMode 这种语义清晰的生成。
export const NoContext = 0b000;
export const ConcurrentMode = 0b001;
export const StrictMode = 0b010;
export const ProfileMode = 0b100;
