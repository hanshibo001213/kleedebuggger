class Subject {
  private waiters: { resolve: () => void; timeout?: NodeJS.Timeout }[] = [];

  // 等待通知的方法，带可选的超时时间
  wait(timeout?: number): Promise<void> {
    const waiter: { resolve: () => void; timeout?: NodeJS.Timeout } = {
      // 先提供一个空的 resolve 方法，将在 Promise 中被赋值
      resolve: () => { }
    };

    const promise = new Promise<void>((resolve) => {
      let resolved = false;

      // 定义 resolve 方法
      waiter.resolve = (noRemove?: boolean) => {
        if (resolved) return;
        resolved = true;

        // 清除超时
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

        // 执行 resolve
        resolve();
      };
    });

    // 处理超时时间
    if (timeout && isFinite(timeout)) {
      waiter.timeout = setTimeout(() => {
        waiter.timeout = undefined;
        waiter.resolve();
      }, timeout);
    }

    // 将 waiter 添加到 waiters 数组中
    this.waiters.push(waiter);

    return promise;
  }

  // 通知一个等待者
  notify(): void {
    if (this.waiters.length > 0) {
      this.waiters.pop()?.resolve();
    }
  }

  // 通知所有等待者
  notifyAll(): void {
    for (const waiter of this.waiters) {
      waiter.resolve();
    }
    this.waiters = [];
  }
}

// 导出类
export { Subject };
