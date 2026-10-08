globalThis.F4FAdapter = {
  async run(checker, collector) {
    const bridge = globalThis.F4FBridge;
    if (!bridge?.claimed || !bridge.running || this.executing) return;
    this.executing = true;
    let originalError = null;
    const adaptedDocument = new Proxy(document, {
      get(target, property) {
        if (property === 'querySelector') return selector => F4FSelectors.querySelector(target, selector);
        if (property === 'querySelectorAll') return selector => selector === 'a' ?
          F4FListControls.forOriginal(target) : target.querySelectorAll(selector);
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    try {
      if (collector) await collector.prepare(() => bridge.running);
      await checker({ document: adaptedDocument, alert: message => {
        originalError = new Error(message); originalError.reason = collector?.failureReason;
      } });
      if (originalError) throw originalError;
      const close = document.getElementById('closeF4FBox');
      if (!close?.parentElement || !close.parentElement.querySelector('ul')) {
        throw new Error('The original checker finished without its results window.');
      }
      if (!bridge.running) return;
      await bridge.finish(close.parentElement, collector?.validation());
    } catch (error) {
      if (collector) document.getElementById('closeF4FBox')?.parentElement?.remove();
      await bridge.fail(error);
    } finally { collector?.dispose(); this.executing = false; }
  }
};
