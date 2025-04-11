class Subject {
  private waiters: { resolve: () => void; timeout?: NodeJS.Timeout }[] = [];

  wait(timeout?: number): Promise<void> {
    const waiter: { resolve: () => void; timeout?: NodeJS.Timeout } = {
      resolve: () => { }
    };

    const promise = new Promise<void>((resolve) => {
      let resolved = false;

      waiter.resolve = (noRemove?: boolean) => {
        if (resolved) return;
        resolved = true;

        if (waiter.timeout) {
          clearTimeout(waiter.timeout);
          waiter.timeout = undefined;
        }

        // 从 waiters 列表中移除
        if (!noRemove) {
          const pos = this.waiters.indexOf(waiter);
          if (pos > -1) {
            this.waiters.splice(pos, 1);
          }
        }

        resolve();
      };
    });

    if (timeout && isFinite(timeout)) {
      waiter.timeout = setTimeout(() => {
        waiter.timeout = undefined;
        waiter.resolve();
      }, timeout);
    }

    this.waiters.push(waiter);

    return promise;
  }

  notify(): void {
    if (this.waiters.length > 0) {
      this.waiters.pop()?.resolve();
    }
  }

  notifyAll(): void {
    for (const waiter of this.waiters) {
      waiter.resolve();
    }
    this.waiters = [];
  }
}

export { Subject };
