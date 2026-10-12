'use strict';
// Deterministic RNG (mulberry32) whose state lives in a plain object so a whole
// game can be serialised, persisted and replayed from a seed.

function makeRng(holder) {
  return {
    next() {
      holder.s = (holder.s + 0x6d2b79f5) >>> 0;
      let t = holder.s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(n) {
      return Math.floor(this.next() * n);
    },
    pick(arr) {
      return arr[this.int(arr.length)];
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = this.int(i + 1);
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    },
  };
}

function seedHolder(seed) {
  return { s: (seed >>> 0) || 1 };
}

module.exports = { makeRng, seedHolder };

