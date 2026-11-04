import { createConcurrencyGate } from '@oln/infrastructure';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestStack, type TestStack } from './fixtures';

let stack: TestStack;

beforeAll(async () => {
  stack = await startTestStack();
});

afterAll(async () => {
  await stack.close();
});

describe('redis concurrency gate', () => {
  it('caps concurrent holders and releases slots', async () => {
    const gate = createConcurrencyGate(stack.redis, 'test-upload', 2, 60);
    const first = await gate();
    const second = await gate();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(await gate()).toBeNull();

    await first?.();
    const third = await gate();
    expect(third).not.toBeNull();
    await third?.();
    await second?.();
    const fourth = await gate();
    expect(fourth).not.toBeNull();
    await fourth?.();
  });
});
