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
      let box, validation;
      try {
        if (collector) await collector.prepare(() => bridge.running);
        await checker({ document: adaptedDocument, alert: message => {
          originalError = collector?.lastFailure || new Error(collector ? message.replace(/^Hata: /, '') : message);
        } });
        if (originalError) throw originalError;
        box = document.getElementById('closeF4FBox')?.parentElement;
        if (!box?.querySelector('ul')) throw new Error('The original checker finished without its results window.');
        if (!bridge.running) return;
        validation = collector?.validation();
      } finally {
        collector?.dispose();
      }
      await bridge.finish(box, validation);
    } catch (error) {
      if (collector) document.getElementById('closeF4FBox')?.parentElement?.remove();
      await bridge.fail(error);
    } finally { this.executing = false; }
  }
};
