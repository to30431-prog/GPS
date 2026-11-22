// src/carModels.js
(function () {
  let stylesInjected = false;
  let lastAppliedHeading = 0;

  // 舞獅去背快取（將黑底轉為透明，保留亮部與舞獅本體）
  const transparentFrameCache = new Map();
  const pendingFramePromises = new Map();

  const CAR_MODELS = {
    garbage_yellow: {
      id: 'garbage_yellow',
      name: '經典清運車',
      src: './assets/cars/garbage_yellow.png',
      width: 124,
      height: 124,
      baseAngle: 0
    },
    recycle_white: {
      id: 'recycle_white',
      name: '白藍資收車',
      src: './assets/cars/recycle_white.png',
      width: 124,
      height: 124,
      baseAngle: 0
    },
    claw_truck: {
      id: 'claw_truck',
      name: '重型抓斗車',
      src: './assets/cars/claw_truck.png',
      width: 132,
      height: 132,
      baseAngle: 0
    },
    thousand_sunny: {
      id: 'thousand_sunny',
      name: '千陽號',
      src: './assets/cars/thousand_sunny.png',
      width: 140,
      height: 140,
      baseAngle: 0
    },
    turtle: {
      id: 'turtle',
      name: '爬行綠蠵龜',
      src: './assets/cars/turtle.png',
      width: 132,
      height: 132,
      baseAngle: 0
    },
    sports_car: {
      id: 'sports_car',
      name: '赤紅超跑',
      src: './assets/cars/sports_car.png',
      width: 120,
      height: 120,
      baseAngle: 0
    },
    santa_sleigh: {
      id: 'santa_sleigh',
      name: '聖誕馴鹿雪橇',
      src: './assets/cars/santa_sleigh_1.png',
      frames: [
        './assets/cars/santa_sleigh_1.png',
        './assets/cars/santa_sleigh_2.png',
        './assets/cars/santa_sleigh_3.png'
      ],
      width: 136,
      height: 136,
      baseAngle: 0
    },
    lion_dance: {
      id: 'lion_dance',
      name: '祥獅獻瑞',
      src: './assets/cars/lion_dance_1.jpg',
      frames: [
        './assets/cars/lion_dance_1.jpg',
        './assets/cars/lion_dance_2.jpg',
        './assets/cars/lion_dance_3.jpg',
        './assets/cars/lion_dance_4.jpg'
      ],
      removeBlackBg: true,
      width: 136,
      height: 136,
      baseAngle: 0
    }
  };

  /**
   * 去除黑底並做邊緣羽化，回傳透明 PNG DataURL
   */
  function getTransparentFrameSrc(rawSrc) {
    if (transparentFrameCache.has(rawSrc)) {
      return Promise.resolve(transparentFrameCache.get(rawSrc));
    }
    if (pendingFramePromises.has(rawSrc)) {
      return pendingFramePromises.get(rawSrc);
    }

    const promise = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const w = img.naturalWidth || img.width || 256;
          const h = img.naturalHeight || img.height || 256;
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, w, h);

          const imgData = ctx.getImageData(0, 0, w, h);
          const d = imgData.data;

          // 低於 low 轉全透明，low~high 之間羽化保留白色絨毛與金色動態線條邊緣
          const low = 24;
          const high = 68;
          const span = high - low;

          for (let i = 0; i < d.length; i += 4) {
            const r = d[i];
            const g = d[i + 1];
            const b = d[i + 2];
            const maxRgb = Math.max(r, g, b);
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            const bright = Math.max(maxRgb, luma);

            if (bright <= low) {
              d[i + 3] = 0;
            } else if (bright < high) {
              const t = (bright - low) / span;
              d[i + 3] = Math.round(d[i + 3] * t * t);
            }
          }

          ctx.putImageData(imgData, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          transparentFrameCache.set(rawSrc, dataUrl);
          resolve(dataUrl);
        } catch (err) {
          console.warn('[carModels] 舞獅去背失敗，改用原圖:', rawSrc, err);
          resolve(rawSrc);
        } finally {
          pendingFramePromises.delete(rawSrc);
        }
      };
      img.onerror = () => {
        pendingFramePromises.delete(rawSrc);
        resolve(rawSrc);
      };
      img.src = rawSrc;
    });

    pendingFramePromises.set(rawSrc, promise);
    return promise;
  }

  function hydrateLionBlackBgRemoval() {
    const lion = CAR_MODELS.lion_dance;
    if (!lion || !Array.isArray(lion.frames)) return;

    lion.frames.forEach((frameUrl, idx) => {
      getTransparentFrameSrc(frameUrl).then((cleanUrl) => {
        if (!cleanUrl || cleanUrl === frameUrl) return;
        document
          .querySelectorAll(`img[data-lion-frame="${idx}"]`)
          .forEach((imgEl) => {
            imgEl.src = cleanUrl;
          });
      });
    });
  }

  function injectCarAnimations() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'car-models-anim-style';
    style.textContent = `
      .vehicle-puck-stage {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        overflow: visible;
        user-select: none;
        -webkit-user-drag: none;
      }
      .vehicle-nav-ring {
        display: none !important;
      }
      .vehicle-heading-rotator {
        position: relative;
        z-index: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: visible;
        will-change: transform;
      }
      .vehicle-img-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: visible;
      }
      .vehicle-img-wrap > img {
        position: relative;
        z-index: 2;
        display: block;
        object-fit: contain;
        max-width: none !important;
        max-height: none !important;
        pointer-events: none;
        filter: drop-shadow(0 5px 8px rgba(15, 23, 42, 0.3));
      }

      /* 序列幀堆疊共用樣式（3格雪橇 / 4格舞獅） */
      .vehicle-sprite-stack {
        position: relative;
        display: inline-block;
        overflow: visible;
      }
      .vehicle-sprite-stack .sprite-frame {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        max-width: none !important;
        max-height: none !important;
        pointer-events: none;
        opacity: 0;
        filter: drop-shadow(0 5px 8px rgba(15, 23, 42, 0.3));
      }
      /* 靜止時固定顯示第 1 格 */
      .vehicle-sprite-stack .sprite-frame-0 {
        position: relative;
        opacity: 1;
        z-index: 2;
      }
      .vehicle-sprite-stack .sprite-frame-1 {
        z-index: 3;
      }
      .vehicle-sprite-stack .sprite-frame-2 {
        z-index: 4;
      }
      .vehicle-sprite-stack .sprite-frame-3 {
        z-index: 5;
      }

      /* 🎅 移動中啟動 3 格逐格奔跑輪播（馴鹿拉雪橇，每輪 0.36s） */
      .vehicle-img-wrap.is-moving[data-car="santa_sleigh"] .vehicle-sprite-stack .sprite-frame-0 {
        animation: spriteFrame0Run 0.36s steps(1, end) infinite;
      }
      .vehicle-img-wrap.is-moving[data-car="santa_sleigh"] .vehicle-sprite-stack .sprite-frame-1 {
        animation: spriteFrame1Run 0.36s steps(1, end) infinite;
      }
      .vehicle-img-wrap.is-moving[data-car="santa_sleigh"] .vehicle-sprite-stack .sprite-frame-2 {
        animation: spriteFrame2Run 0.36s steps(1, end) infinite;
      }

      /* 🦁 移動中啟動 4 格逐格搖頭擺動輪播（祥獅獻瑞 1→2→3→4，每輪 0.96s / 每格 0.24s） */
      .vehicle-img-wrap.is-moving[data-car="lion_dance"] .vehicle-sprite-stack .sprite-frame-0 {
        animation: lionFrame0Run 0.96s steps(1, end) infinite;
      }
      .vehicle-img-wrap.is-moving[data-car="lion_dance"] .vehicle-sprite-stack .sprite-frame-1 {
        animation: lionFrame1Run 0.96s steps(1, end) infinite;
      }
      .vehicle-img-wrap.is-moving[data-car="lion_dance"] .vehicle-sprite-stack .sprite-frame-2 {
        animation: lionFrame2Run 0.96s steps(1, end) infinite;
      }
      .vehicle-img-wrap.is-moving[data-car="lion_dance"] .vehicle-sprite-stack .sprite-frame-3 {
        animation: lionFrame3Run 0.96s steps(1, end) infinite;
      }

      /* 選單預覽、雷達小車標與省電模式停用逐格輪播，只顯示第 1 格 */
      button .vehicle-sprite-stack .sprite-frame,
      .car-option .vehicle-sprite-stack .sprite-frame,
      [data-car-select] .vehicle-sprite-stack .sprite-frame,
      .car-picker-item .vehicle-sprite-stack .sprite-frame,
      .vehicle-card .vehicle-sprite-stack .sprite-frame,
      .fleet-car-svg-wrap .vehicle-sprite-stack .sprite-frame,
      body.power-saving .vehicle-sprite-stack .sprite-frame {
        animation: none !important;
        opacity: 0 !important;
      }
      button .vehicle-sprite-stack .sprite-frame-0,
      .car-option .vehicle-sprite-stack .sprite-frame-0,
      [data-car-select] .vehicle-sprite-stack .sprite-frame-0,
      .car-picker-item .vehicle-sprite-stack .sprite-frame-0,
      .vehicle-card .vehicle-sprite-stack .sprite-frame-0,
      .fleet-car-svg-wrap .vehicle-sprite-stack .sprite-frame-0,
      body.power-saving .vehicle-sprite-stack .sprite-frame-0 {
        opacity: 1 !important;
      }

      /* 3 格雪橇 Keyframes */
      @keyframes spriteFrame0Run {
        0%, 33.32%   { opacity: 1; }
        33.33%, 100% { opacity: 0; }
      }
      @keyframes spriteFrame1Run {
        0%, 33.32%   { opacity: 0; }
        33.33%, 66.65% { opacity: 1; }
        66.66%, 100% { opacity: 0; }
      }
      @keyframes spriteFrame2Run {
        0%, 66.65%   { opacity: 0; }
        66.66%, 100% { opacity: 1; }
      }

      /* 4 格舞獅 Keyframes (1 → 2 → 3 → 4) */
      @keyframes lionFrame0Run {
        0%, 24.99%   { opacity: 1; }
        25%, 100%    { opacity: 0; }
      }
      @keyframes lionFrame1Run {
        0%, 24.99%   { opacity: 0; }
        25%, 49.99%  { opacity: 1; }
        50%, 100%    { opacity: 0; }
      }
      @keyframes lionFrame2Run {
        0%, 49.99%   { opacity: 0; }
        50%, 74.99%  { opacity: 1; }
        75%, 100%    { opacity: 0; }
      }
      @keyframes lionFrame3Run {
        0%, 74.99%   { opacity: 0; }
        75%, 100%    { opacity: 1; }
      }

      /* ☀️ 千陽號專屬 SVG 前進水波紋 */
      .sunny-wake-svg {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 196px;
        height: 236px;
        transform: translate(-50%, -44%);
        z-index: 1;
        pointer-events: none;
        overflow: visible;
        opacity: 0;
        transition: opacity 0.25s ease;
      }
      .vehicle-img-wrap.is-moving[data-car="thousand_sunny"] .sunny-wake-svg {
        opacity: 1;
      }
      .sunny-bow-wave-1 {
        animation: sunnyBowRipple 1.15s cubic-bezier(0.22, 0.61, 0.36, 1) infinite;
        transform-origin: 100px 42px;
      }
      .sunny-bow-wave-2 {
        animation: sunnyBowRipple 1.15s cubic-bezier(0.22, 0.61, 0.36, 1) 0.55s infinite;
        transform-origin: 100px 42px;
      }
      .sunny-stern-wake-1 {
        animation: sunnySternWake 1.3s ease-out infinite;
        transform-origin: 100px 158px;
      }
      .sunny-stern-wake-2 {
        animation: sunnySternWake 1.3s ease-out 0.65s infinite;
        transform-origin: 100px 158px;
      }
      @keyframes sunnyBowRipple {
        0% {
          opacity: 0;
          transform: translateY(-4px) scale(0.82);
        }
        25% {
          opacity: 0.92;
        }
        100% {
          opacity: 0;
          transform: translateY(18px) scale(1.22);
        }
      }
      @keyframes sunnySternWake {
        0% {
          opacity: 0;
          transform: translateY(-6px) scaleX(0.75) scaleY(0.8);
        }
        30% {
          opacity: 0.85;
        }
        100% {
          opacity: 0;
          transform: translateY(24px) scaleX(1.32) scaleY(1.25);
        }
      }

      /* 🚚💨 汽車車尾排氣動畫（四款車共用） */
      .car-exhaust-svg {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 140px;
        height: 176px;
        transform: translate(-50%, -34%);
        z-index: 1;
        pointer-events: none;
        overflow: visible;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .vehicle-img-wrap.is-moving:not([data-car="thousand_sunny"]):not([data-car="turtle"]):not([data-car="santa_sleigh"]):not([data-car="lion_dance"]) .car-exhaust-svg {
        opacity: 1;
      }
      .exhaust-puff-1 {
        animation: exhaustPuffMove 0.85s ease-out infinite;
        transform-box: fill-box;
        transform-origin: center;
      }
      .exhaust-puff-2 {
        animation: exhaustPuffMove 0.85s ease-out 0.28s infinite;
        transform-box: fill-box;
        transform-origin: center;
      }
      .exhaust-puff-3 {
        animation: exhaustPuffMove 0.85s ease-out 0.56s infinite;
        transform-box: fill-box;
        transform-origin: center;
      }
      @keyframes exhaustPuffMove {
        0% {
          opacity: 0.85;
          transform: translateY(-4px) scale(0.55);
        }
        55% {
          opacity: 0.52;
        }
        100% {
          opacity: 0;
          transform: translateY(22px) scale(1.45);
        }
      }

      /* 🐢 綠蠵龜後方划水尾波與氣泡 */
      .turtle-wake-svg {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 170px;
        height: 205px;
        transform: translate(-50%, -34%);
        z-index: 1;
        pointer-events: none;
        overflow: visible;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .vehicle-img-wrap.is-moving[data-car="turtle"] .turtle-wake-svg {
        opacity: 1;
      }
      .turtle-wave-left {
        animation: turtleFlipperWave 0.95s ease-out infinite;
        transform-box: fill-box;
        transform-origin: center;
      }
      .turtle-wave-right {
        animation: turtleFlipperWave 0.95s ease-out 0.47s infinite;
        transform-box: fill-box;
        transform-origin: center;
      }
      .turtle-bubble-1 {
        animation: turtleBubbleTrail 0.9s ease-out infinite;
        transform-box: fill-box;
        transform-origin: center;
      }
      .turtle-bubble-2 {
        animation: turtleBubbleTrail 0.9s ease-out 0.3s infinite;
        transform-box: fill-box;
        transform-origin: center;
      }
      .turtle-bubble-3 {
        animation: turtleBubbleTrail 0.9s ease-out 0.6s infinite;
        transform-box: fill-box;
        transform-origin: center;
      }
      @keyframes turtleFlipperWave {
        0% {
          opacity: 0.95;
          transform: translateY(-4px) scale(0.75);
        }
        100% {
          opacity: 0;
          transform: translateY(24px) scale(1.32);
        }
      }
      @keyframes turtleBubbleTrail {
        0% {
          opacity: 0.95;
          transform: translateY(-2px) scale(0.6);
        }
        100% {
          opacity: 0;
          transform: translateY(26px) scale(1.25);
        }
      }

      /* 選單預覽、雷達小車標、靜態與省電模式隱藏特效 */
      button .sunny-wake-svg,
      .car-option .sunny-wake-svg,
      [data-car-select] .sunny-wake-svg,
      .car-picker-item .sunny-wake-svg,
      .vehicle-card .sunny-wake-svg,
      .fleet-car-svg-wrap .sunny-wake-svg,
      .vehicle-img-wrap:not(.is-moving) .sunny-wake-svg,
      body.power-saving .sunny-wake-svg,
      button .car-exhaust-svg,
      .car-option .car-exhaust-svg,
      [data-car-select] .car-exhaust-svg,
      .car-picker-item .car-exhaust-svg,
      .vehicle-card .car-exhaust-svg,
      .fleet-car-svg-wrap .car-exhaust-svg,
      .vehicle-img-wrap:not(.is-moving) .car-exhaust-svg,
      body.power-saving .car-exhaust-svg,
      button .turtle-wake-svg,
      .car-option .turtle-wake-svg,
      [data-car-select] .turtle-wake-svg,
      .car-picker-item .turtle-wake-svg,
      .vehicle-card .turtle-wake-svg,
      .fleet-car-svg-wrap .turtle-wake-svg,
      .vehicle-img-wrap:not(.is-moving) .turtle-wake-svg,
      body.power-saving .turtle-wake-svg {
        display: none !important;
      }

      /* 車隊雷達隊友小車標限制尺寸 */
      .fleet-car-svg-wrap .vehicle-puck-stage,
      .fleet-car-svg-wrap .vehicle-heading-rotator,
      .fleet-car-svg-wrap .vehicle-img-wrap {
        width: 48px !important;
        height: 48px !important;
      }
      .fleet-car-svg-wrap img {
        width: 48px !important;
        height: 48px !important;
        max-width: 48px !important;
        max-height: 48px !important;
        object-fit: contain !important;
      }

      /* 換車選單卡片內縮圖限制 */
      button .vehicle-img-wrap img,
      .car-option .vehicle-img-wrap img,
      [data-car-select] .vehicle-img-wrap img,
      .car-picker-item .vehicle-img-wrap img,
      .vehicle-card .vehicle-img-wrap img {
        max-width: 72px !important;
        max-height: 72px !important;
      }

      /* 🐢 烏龜俯視划動 */
      .vehicle-img-wrap.is-moving[data-car="turtle"] > img {
        animation: turtleWaddleTopDown 0.55s ease-in-out infinite alternate;
      }
      /* ☀️ 千陽號俯視破浪 */
      .vehicle-img-wrap.is-moving[data-car="thousand_sunny"] > img {
        animation: sunnyBobTopDown 1.2s ease-in-out infinite;
      }
      /* 🚚💨 一般車輛俯視行駛輕微震動 */
      .vehicle-img-wrap.is-moving:not([data-car="turtle"]):not([data-car="thousand_sunny"]):not([data-car="santa_sleigh"]):not([data-car="lion_dance"]) > img {
        animation: carDriveBounceTopDown 0.5s ease-in-out infinite;
      }
      /* 靜態與省電模式移除動畫 */
      .vehicle-img-wrap:not(.is-moving) > img,
      body.power-saving .vehicle-img-wrap > img {
        animation: none !important;
      }
      @keyframes turtleWaddleTopDown {
        0%   { transform: rotate(-4.5deg); }
        100% { transform: rotate(4.5deg); }
      }
      @keyframes sunnyBobTopDown {
        0%, 100% { transform: translateY(0px) rotate(-1.5deg); }
        50%      { transform: translateY(-2px) rotate(1.5deg); }
      }
      @keyframes carDriveBounceTopDown {
        0%, 100% { transform: translateY(0px); }
        50%      { transform: translateY(-1.2px); }
      }
    `;
    document.head.appendChild(style);
  }

  function renderVehicleVisual(model) {
    if (Array.isArray(model.frames) && model.frames.length >= 3) {
      const isLion = Boolean(model.removeBlackBg);
      const framesHtml = model.frames
        .map((frameSrc, idx) => {
          const cachedSrc = isLion && transparentFrameCache.get(frameSrc);
          const finalSrc = cachedSrc || frameSrc;
          const lionAttr = isLion ? ` data-lion-frame="${idx}"` : '';
          const altText = idx === 0 ? model.name : '';
          const ariaHidden = idx === 0 ? '' : ' aria-hidden="true"';

          return `<img class="sprite-frame sprite-frame-${idx}" src="${finalSrc}" alt="${altText}" width="${model.width}" height="${model.height}" loading="eager"${lionAttr}${ariaHidden} />`;
        })
        .join('');

      if (isLion) {
        queueMicrotask(hydrateLionBlackBgRemoval);
      }

      return `
        <span class="vehicle-sprite-stack" style="width:${model.width}px;height:${model.height}px;">
          ${framesHtml}
        </span>
      `;
    }
    return `<img src="${model.src}" alt="${model.name}" width="${model.width}" height="${model.height}" loading="eager" />`;
  }

  function syncCarMovingState(isMoving) {
    const pausedByPowerSave = document.body.classList.contains('power-saving');
    const active = Boolean(isMoving) && !pausedByPowerSave;

    document.querySelectorAll('.vehicle-anim, .vehicle-img-wrap').forEach((el) => {
      el.classList.toggle('is-moving', active);
    });
  }

  function syncCarHeading(courseDeg, mapBearingDeg = 0) {
    if (typeof courseDeg !== 'number' || Number.isNaN(courseDeg)) return;

    const model = CAR_MODELS[getMyCarType()] || CAR_MODELS.garbage_yellow;
    const baseAngle = typeof model.baseAngle === 'number' ? model.baseAngle : 0;
    const target = courseDeg - (Number(mapBearingDeg) || 0) - baseAngle;

    let delta = ((target - lastAppliedHeading + 540) % 360) - 180;
    lastAppliedHeading += delta;

    document.querySelectorAll('#my-puck .vehicle-heading-rotator, .my-car-marker .vehicle-heading-rotator').forEach((el) => {
      el.style.transform = `rotate(${lastAppliedHeading.toFixed(1)}deg)`;
    });
  }

  function getMyCarType() {
    try {
      const saved = localStorage.getItem('yingge_selected_car');
      return saved && CAR_MODELS[saved] ? saved : 'garbage_yellow';
    } catch (_) {
      return 'garbage_yellow';
    }
  }

  function setMyCarType(carTypeId) {
    const validId = CAR_MODELS[carTypeId] ? carTypeId : 'garbage_yellow';
    try {
      localStorage.setItem('yingge_selected_car', validId);
    } catch (_) {}
    return validId;
  }

  function getCarSvg(carTypeId, isMoving = false) {
    injectCarAnimations();
    const model = CAR_MODELS[carTypeId] || CAR_MODELS.garbage_yellow;
    const movingClass = isMoving ? ' is-moving' : '';

    let effectHtml = '';
    if (model.id === 'thousand_sunny') {
      effectHtml = getSunnyWakeSvg();
    } else if (model.id === 'turtle') {
      effectHtml = getTurtleWakeSvg();
    } else if (model.id !== 'santa_sleigh' && model.id !== 'lion_dance') {
      effectHtml = getCarExhaustSvg();
    }

    return `
      <span class="vehicle-puck-stage">
        <span class="vehicle-heading-rotator">
          <span class="vehicle-anim vehicle-img-wrap${movingClass}" data-car="${model.id}">
            ${effectHtml}
            ${renderVehicleVisual(model)}
          </span>
        </span>
      </span>
    `;
  }

  window.CAR_MODELS = CAR_MODELS;
  window.injectCarAnimations = injectCarAnimations;
  window.syncCarMovingState = syncCarMovingState;
  window.syncCarHeading = syncCarHeading;
  window.getMyCarType = getMyCarType;
  window.setMyCarType = setMyCarType;
  window.getCarSvg = getCarSvg;
})();
