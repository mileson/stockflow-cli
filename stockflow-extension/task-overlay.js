// 商品任务光效：移植 multisync 完整点阵波纹、柔化渐变边缘和底部状态卡；复用品牌图标。
// 注入隔离世界；装饰不拦截页面。隐藏时暂停动画，移除时清理帧循环和监听器。
(function(root) {
  root.StockFlowTaskOverlay = function updateTaskOverlay(state) {
    function startPublishWaves(veil) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext?.('2d');
      if (!ctx) return () => {};
      canvas.style.cssText = 'all:initial;position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      canvas.setAttribute('aria-hidden', 'true');
      veil.append(canvas);

      const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
      let frame = 0;
      let lastDraw = -Infinity;
      function draw(time) {
        const width = window.innerWidth, height = window.innerHeight;
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        ctx.clearRect(0, 0, width, height);
        const step = Math.max(8, Math.ceil(Math.sqrt(width * height / 18000)));
        const t = time / 1000;
        for (let y = step / 2; y < height; y += step) {
          const v = y / height;
          for (let x = step / 2; x < width; x += step) {
            const u = x / width;
            const flow = Math.sin(u * 9 + v * 5 - t * .8) + .55 * Math.sin(v * 13 - u * 4 + t * .55);
            const ripple = Math.sin(Math.hypot(u - .35, v - .45) * 24 - t * 1.65 + flow);
            const intensity = .1 + .9 * ((ripple + 1) / 2) ** 3;
            const size = 1.1 + intensity * 1.3;
            ctx.fillStyle = '#6184c4';
            ctx.globalAlpha = .035 + intensity * .13;
            ctx.fillRect(x - (size + 1) / 2, y - (size + 1) / 2, size + 1, size + 1);
            ctx.fillStyle = '#fff';
            ctx.globalAlpha = .12 + intensity * .65;
            ctx.fillRect(x - size / 2, y - size / 2, size, size);
          }
        }
      }
      function tick(time) {
        if (time - lastDraw >= 50) {
          draw(time);
          lastDraw = time;
        }
        frame = window.requestAnimationFrame(tick);
      }
      function sync() {
        window.cancelAnimationFrame(frame);
        if (document.hidden) return;
        lastDraw = -Infinity;
        if (motion.matches) draw(0);
        else {
        // Paint immediately: fast CLI reads can finish before the first animation callback.
        draw(performance.now());
        frame = window.requestAnimationFrame(tick);
      }
      }
      document.addEventListener('visibilitychange', sync);
      motion.addEventListener('change', sync);
      window.addEventListener('resize', sync);
      sync();
      return () => {
        window.cancelAnimationFrame(frame);
        document.removeEventListener('visibilitychange', sync);
        motion.removeEventListener('change', sync);
        window.removeEventListener('resize', sync);
      };
    }
    const id='stockflow-task-overlay';
    let host=document.getElementById(id);
    if(!state) { host?.__stockFlowDispose?.(); host?.remove(); return; }
    if(!host) {
      host=document.createElement('div');host.id=id;
      host.style.cssText='all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
      const shadow=host.attachShadow({mode:'open'});
      shadow.innerHTML=`<style>
        :host{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:white}
        *{box-sizing:border-box}
        .veil{position:absolute;inset:0;background:rgba(15,23,42,.32);pointer-events:none}
        .edge-layer{position:absolute;inset:0;pointer-events:none;filter:blur(12px)}
        .edge{position:absolute;inset:0;padding:16px;pointer-events:none;opacity:1;background:linear-gradient(115deg,#bc82f3,#f5b9ea,#8d9fff,#ff6778,#ffba71,#c686ff,#bc82f3);background-size:300% 300%;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:flow 12s linear infinite alternate}
        .card{color:#fff;font:500 14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;position:absolute;left:50%;bottom:28px;transform:translateX(-50%);display:flex;align-items:center;gap:16px;width:min(440px,calc(100vw - 32px));padding:18px 20px;border:1px solid #ffffff30;border-radius:18px;background:rgba(30,35,45,.94);box-shadow:0 12px 40px #10182844;pointer-events:auto}
        .brand{display:block;flex:none;width:40px;height:40px;object-fit:contain}
        .copy{flex:1;min-width:0}.title{font-size:14px;font-weight:650;line-height:1.6}.subtitle{margin-top:3px;color:#aac1e9;font-size:12px;line-height:1.5}
        button{border:0;border-radius:9px;padding:9px 12px;color:#ffa89c;background:#ffffff12;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer}button:focus-visible{outline:2px solid #aac1e9}button:disabled{opacity:.6}
        @keyframes flow{from{background-position:0% 50%}to{background-position:100% 50%}}
        @media(prefers-reduced-motion:reduce){.edge{animation:none}}
      </style><div class="veil"></div><div class="edge-layer" aria-hidden="true"><div class="edge"></div></div><section class="card" role="status" aria-live="polite"><img class="brand" alt="货源满满"><div class="copy"><div class="title"></div><div class="subtitle"></div></div><button type="button">停止</button></section>`;
      shadow.querySelector('.brand').src=state.logoUrl || chrome.runtime.getURL('icons/icon-48.png');
      const button=shadow.querySelector('button');
      button.addEventListener('click',async()=>{
        button.disabled=true;
        try {
          if(state.stopMode==='page') {
            globalThis.__stockFlowStopRequested=true;
            shadow.querySelector('.subtitle').textContent='当前商品结束后停止，已采集结果会保留';
            return;
          }
          const result=await chrome.runtime.sendMessage({type:'STOCKFLOW_BATCH_STOP'});
          if(!result?.ok) throw Error();
          shadow.querySelector('.subtitle').textContent='当前商品结束后停止，已采集结果会保留';
        } catch {button.disabled=false;shadow.querySelector('.subtitle').textContent='暂时无法停止，请重试';}
      });
      document.documentElement.append(host);
      let stopWaves;
      try { stopWaves=startPublishWaves(shadow.querySelector('.veil')); } catch { /* Keep task controls usable if canvas is unavailable. */ }
      const observer=new MutationObserver(()=>{ if(!host.isConnected) host.__stockFlowDispose(); });
      const dispose=()=>{
        stopWaves?.();stopWaves=null;
        observer.disconnect();
        window.removeEventListener('pagehide',dispose);
      };
      host.__stockFlowDispose=dispose;
      observer.observe(document.documentElement,{childList:true});
      window.addEventListener('pagehide',dispose,{once:true});
    }
    host.shadowRoot.querySelector('.title').textContent=`正在采集商品 · ${state.index} / ${state.total}`;
    if(!host.shadowRoot.querySelector('button').disabled) host.shadowRoot.querySelector('.subtitle').textContent=state.message || '货源满满正在读取商品信息';
  };
  if(typeof module !== 'undefined' && module.exports) module.exports=root.StockFlowTaskOverlay;
})(globalThis);
