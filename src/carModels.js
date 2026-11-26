// src/carModels.js
(function () {
  let stylesInjected = false;
  let lastAppliedHeading = 0;

  // ==========================================
  // 🎯 地圖本機車標大小設定（直接修改此處即可調整地圖上的專屬車款圖標大小）
  // 1. globalMapScale: 全車款統一縮放倍率（預設 1.0；例如改 1.15 整體放大 15%，改 0.85 整體縮小 15%）
  // 2. defaultMapSizePx: 未指定個別寬高時的預設基準像素尺寸
  // 3. 各車款也可直接在下方 CAR_MODELS[車款ID] 修改 width / height（單位 px）或 mapScale（個別倍率）
  // ==========================================
  const CAR_MARKER_SIZE_CONFIG = {
    globalMapScale: 1.0,
    defaultMapSizePx: 124
  };

  const CAR_MODELS = {
    garbage_yellow: {
      id: 'garbage_yellow',
      name: '經典清運車',
      src: './assets/cars/garbage_yellow.png',
      width: 124,
      height: 124,
      mapScale: 1.0,
      baseAngle: 0
    },
    recycle_white: {
      id: 'recycle_white',
      name: '白藍資收車',
      src: './assets/cars/recycle_white.png',
      width: 124,
      height: 124,
      ,
      baseAngle: 0
    },
    claw_truck: {
      id: 'claw_truck',
      name: '重型抓斗車',
      src: './assets/cars/claw_truck.png',
      width: 132,
      height: 132,
      ,
      baseAngle: 0
    },
    thousand_sunny: {
      id: 'thousand_sunny',
      name: '千陽號',
      src: './assets/cars/thousand_sunny.png',
      width: 140,
      height: 140,
      ,
      baseAngle: 0
    },
    turtle: {
      id: 'turtle',
      name: '爬行綠蠵龜',
      src: './assets/cars/turtle.png',
      width: 132,
      height: 132,
      ,
      baseAngle: 0
    },
    sports_car: {
      id: 'sports_car',
      name: '赤紅超跑',
      src: './assets/cars/sports_car.png',
      width: 120,
      height: 120,
      ,
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
      ,
      baseAngle: 0
    },
    lion_dance: {
      id: 'lion_dance',
      name: '祥獅獻瑞',
      src: './assets/cars/lion_dance_1.png',
      frames: [
        './assets/cars/lion_dance_1.png',
        './assets/cars/lion_dance_2.png',
        './assets/cars/lion_dance_3.png',
        './assets/cars/lion_dance_4.png'
      ],
      width: 92,
      height: 92,
     ,
      baseAngle: 0
    },
    pumpkin_carriage: {
      id: 'pumpkin_carriage',
      name: '🎃 萬聖節南瓜馬車',
      src: './assets/cars/pumpkin_carriage_1.png',
      frames: [
        './assets/cars/pumpkin_carriage_1.png',
        './assets/cars/pumpkin_carriage_2.png',
        './assets/cars/pumpkin_carriage_3.png'
      ],
      width: 136,
      height: 136,
      mapScale: 0.7,
      baseAngle: 0
    }
  };

  function getCarMapDisplaySize(modelOrId) {
    const model = (typeof modelOrId === 'string' ? CAR_MODELS[modelOrId] : modelOrId) || CAR_MODELS.garbage_yellow;
    const baseW = Number(model.width) || CAR_MARKER_SIZE_CONFIG.defaultMapSizePx;
    const baseH = Number(model.height) || CAR_MARKER_SIZE_CONFIG.defaultMapSizePx;
    const globalScale = (typeof CAR_MARKER_SIZE_CONFIG.globalMapScale === 'number' && CAR_MARKER_SIZE_CONFIG.globalMapScale > 0)
      ? CAR_MARKER_SIZE_CONFIG.globalMapScale
      : 1.0;
    const modelScale = (typeof model.mapScale === 'number' && model.mapScale > 0)
      ? model.mapScale
      : 1.0;
    const finalScale = globalScale * modelScale;
    return {
      width: Math.max(24, Math.round(baseW * finalScale)),
      height: Math.max(24, Math.round(baseH * finalScale)),
      scale: finalScale
    };
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
        flex-shrink: 0;
        line-height: 1;
        overflow: visible;
        user-select: none;
        -webkit-user-drag: none;
        pointer-events: none;
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
        flex-shrink: 0;
        transform-origin: 50% 50%;
        overflow: visible;
        will-change: transform;
        pointer-events: none;
      }
      .vehicle-img-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: var(--car-map-w, 124px);
        height: var(--car-map-h, 124px);
        overflow: visible;
        pointer-events: none;
      }
      .vehicle-img-wrap > img {
        position: relative;
        z-index: 2;
        display: block;
        width: var(--car-map-w, 124px) !important;
        height: var(--car-map-h, 124px) !important;
        object-fit: contain;
        max-width: none !important;
        max-height: none !important;
        pointer-events: none;
        filter: drop-shadow(0 5px 8px rgba(15, 23, 42, 0.3));
      }

      .vehicle-sprite-stack {
        position: relative;
        display: inline-block;
        flex-shrink: 0;
        width: var(--car-map-w, 124px);
        height: var(--car-map-h, 124px);
        overflow: visible;
        pointer-events: none;
      }
      .vehicle-sprite-stack .sprite-frame {
        position: absolute;
        top: 0;
        left: 0;
        width: 100% !important;
        height: 100% !important;
        object-fit: contain;
        max-width: none !important;
        max-height: none !important;
        pointer-events: none;
        opacity: 0;
        filter: drop-shadow(0 5px 8px rgba(15, 23, 42, 0.3));
      }
      .vehicle-sprite-stack .sprite-frame-0 {
        position: relative;
        opacity: 1;
        z-index: 2;
      }
      .vehicle-sprite-stack .sprite-frame-1 { z-index: 3; }
      .vehicle-sprite-stack .sprite-frame-2 { z-index: 4; }
      .vehicle-sprite-stack .sprite-frame-3 { z-index: 5; }

      .vehicle-img-wrap.is-moving[data-car="santa_sleigh"] .vehicle-sprite-stack .sprite-frame-0,
      .vehicle-img-wrap.is-moving[data-car="pumpkin_carriage"] .vehicle-sprite-stack .sprite-frame-0 {
        animation: spriteFrame0Run 0.36s steps(1, end) infinite;
      }
      .vehicle-img-wrap.is-moving[data-car="santa_sleigh"] .vehicle-sprite-stack .sprite-frame-1,
      .vehicle-img-wrap.is-moving[data-car="pumpkin_carriage"] .vehicle-sprite-stack .sprite-frame-1 {
        animation: spriteFrame1Run 0.36s steps(1, end) infinite;
      }
      .vehicle-img-wrap.is-moving[data-car="santa_sleigh"] .vehicle-sprite-stack .sprite-frame-2,
      .vehicle-img-wrap.is-moving[data-car="pumpkin_carriage"] .vehicle-sprite-stack .sprite-frame-2 {
        animation: spriteFrame2Run 0.36s steps(1, end) infinite;
      }

      /* 🦁 4 格舞獅逐格搖頭輪播 (1 → 2 → 3 → 4) */
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
        0% { opacity: 0; transform: translateY(-4px) scale(0.82); }
        25% { opacity: 0.92; }
        100% { opacity: 0; transform: translateY(18px) scale(1.22); }
      }
      @keyframes sunnySternWake {
        0% { opacity: 0; transform: translateY(-6px) scaleX(0.75) scaleY(0.8); }
        30% { opacity: 0.85; }
        100% { opacity: 0; transform: translateY(24px) scaleX(1.32) scaleY(1.25); }
      }

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
      .vehicle-img-wrap.is-moving:not([data-car="thousand_sunny"]):not([data-car="turtle"]):not([data-car="santa_sleigh"]):not([data-car="lion_dance"]):not([data-car="pumpkin_carriage"]) .car-exhaust-svg {
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
        0% { opacity: 0.85; transform: translateY(-4px) scale(0.55); }
        55% { opacity: 0.52; }
        100% { opacity: 0; transform: translateY(22px) scale(1.45); }
      }

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
        0% { opacity: 0.95; transform: translateY(-4px) scale(0.75); }
        100% { opacity: 0; transform: translateY(24px) scale(1.32); }
      }
      @keyframes turtleBubbleTrail {
        0% { opacity: 0.95; transform: translateY(-2px) scale(0.6); }
        100% { opacity: 0; transform: translateY(26px) scale(1.25); }
      }

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

      .fleet-car-svg-wrap .vehicle-puck-stage,
      .fleet-car-svg-wrap .vehicle-heading-rotator,
      .fleet-car-svg-wrap .vehicle-img-wrap,
      .fleet-car-svg-wrap .vehicle-sprite-stack {
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

      button .vehicle-img-wrap,
      .car-option .vehicle-img-wrap,
      [data-car-select] .vehicle-img-wrap,
      .car-picker-item .vehicle-img-wrap,
      .vehicle-card .vehicle-img-wrap {
        width: auto !important;
        height: auto !important;
      }
      button .vehicle-img-wrap > img,
      .car-option .vehicle-img-wrap > img,
      [data-car-select] .vehicle-img-wrap > img,
      .car-picker-item .vehicle-img-wrap > img,
      .vehicle-card .vehicle-img-wrap > img {
        width: auto !important;
        height: auto !important;
        max-width: 72px !important;
        max-height: 72px !important;
      }
      button .vehicle-img-wrap .vehicle-sprite-stack,
      .car-option .vehicle-img-wrap .vehicle-sprite-stack,
      [data-car-select] .vehicle-img-wrap .vehicle-sprite-stack,
      .car-picker-item .vehicle-img-wrap .vehicle-sprite-stack,
      .vehicle-card .vehicle-img-wrap .vehicle-sprite-stack {
        width: 58px !important;
        height: 58px !important;
      }
      button .vehicle-img-wrap[data-car="santa_sleigh"] .vehicle-sprite-stack,
.car-option .vehicle-img-wrap[data-car="santa_sleigh"] .vehicle-sprite-stack,
[data-car-select] .vehicle-img-wrap[data-car="santa_sleigh"] .vehicle-sprite-stack,
.car-picker-item .vehicle-img-wrap[data-car="santa_sleigh"] .vehicle-sprite-stack,
.vehicle-card .vehicle-img-wrap[data-car="santa_sleigh"] .vehicle-sprite-stack {
  transform: scale(1.35);
  transform-origin: center center;
}
      .vehicle-img-wrap.is-moving[data-car="turtle"] > img {
        animation: turtleWaddleTopDown 0.55s ease-in-out infinite alternate;
      }
      .vehicle-img-wrap.is-moving[data-car="thousand_sunny"] > img {
        animation: sunnyBobTopDown 1.2s ease-in-out infinite;
      }
      .vehicle-img-wrap.is-moving:not([data-car="turtle"]):not([data-car="thousand_sunny"]):not([data-car="santa_sleigh"]):not([data-car="lion_dance"]):not([data-car="pumpkin_carriage"]) > img {
        animation: carDriveBounceTopDown 0.5s ease-in-out infinite;
      }
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

  function getSunnyWakeSvg() {
    return `
      <svg class="sunny-wake-svg" viewBox="0 0 200 240" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="sunnyWakeGrad" x1="100" y1="30" x2="100" y2="230" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#E0F2FE" stop-opacity="0.95" />
            <stop offset="50%" stop-color="#38BDF8" stop-opacity="0.7" />
            <stop offset="100%" stop-color="#0284C7" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path class="sunny-bow-wave-1" d="M52 74 Q100 22 148 74" stroke="url(#sunnyWakeGrad)" stroke-width="5.5" stroke-linecap="round" />
        <path class="sunny-bow-wave-2" d="M42 90 Q100 30 158 90" stroke="#BAE6FD" stroke-width="3.5" stroke-linecap="round" />
        <path class="sunny-stern-wake-1" d="M66 154 Q100 176 134 154 M56 172 Q100 198 144 172" stroke="url(#sunnyWakeGrad)" stroke-width="5" stroke-linecap="round" />
        <path class="sunny-stern-wake-2" d="M60 186 Q100 214 140 186 M74 204 Q100 226 126 204" stroke="#E0F2FE" stroke-width="3.5" stroke-linecap="round" />
      </svg>
    `;
  }

  function getCarExhaustSvg() {
    return `
      <svg class="car-exhaust-svg" viewBox="0 0 140 180" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle class="exhaust-puff-1" cx="70" cy="116" r="7.5" fill="#F1F5F9" stroke="#CBD5E1" stroke-width="1.5" />
        <circle class="exhaust-puff-2" cx="62" cy="128" r="9.5" fill="#E2E8F0" stroke="#CBD5E1" stroke-width="1.5" />
        <circle class="exhaust-puff-3" cx="78" cy="134" r="10.5" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.5" />
      </svg>
    `;
  }

  function getTurtleWakeSvg() {
    return `
      <svg class="turtle-wake-svg" viewBox="0 0 170 205" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path class="turtle-wave-left" d="M38 124 Q85 156 132 124" stroke="#059669" stroke-width="5.5" stroke-linecap="round" />
        <path class="turtle-wave-right" d="M30 144 Q85 178 140 144" stroke="#10B981" stroke-width="4.5" stroke-linecap="round" />
        <circle class="turtle-bubble-1" cx="85" cy="154" r="5" fill="#A7F3D0" stroke="#059669" stroke-width="1.5" />
        <circle class="turtle-bubble-2" cx="68" cy="166" r="6" fill="#D1FAE5" stroke="#10B981" stroke-width="1.5" />
        <circle class="turtle-bubble-3" cx="102" cy="168" r="5.5" fill="#6EE7B7" stroke="#059669" stroke-width="1.5" />
      </svg>
    `;
  }

  function renderVehicleVisual(model, displaySize) {
    const size = displaySize || getCarMapDisplaySize(model);
    if (Array.isArray(model.frames) && model.frames.length >= 3) {
      const framesHtml = model.frames
        .map((frameSrc, idx) => {
          const altText = idx === 0 ? model.name : '';
          const ariaHidden = idx === 0 ? '' : ' aria-hidden="true"';
          return `<img class="sprite-frame sprite-frame-${idx}" src="${frameSrc}" alt="${altText}" width="${size.width}" height="${size.height}" loading="eager"${ariaHidden} />`;
        })
        .join('');

      return `
        <span class="vehicle-sprite-stack" style="width:${size.width}px;height:${size.height}px;">
          ${framesHtml}
        </span>
      `;
    }
    return `<img src="${model.src}" alt="${model.name}" width="${size.width}" height="${size.height}" loading="eager" />`;
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
    const displaySize = getCarMapDisplaySize(model);
    const movingClass = isMoving ? ' is-moving' : '';

    let effectHtml = '';
    if (model.id === 'thousand_sunny') {
      effectHtml = getSunnyWakeSvg();
    } else if (model.id === 'turtle') {
      effectHtml = getTurtleWakeSvg();
    } else if (model.id !== 'santa_sleigh' && model.id !== 'lion_dance' && model.id !== 'pumpkin_carriage') {
      effectHtml = getCarExhaustSvg();
    }

    return `
      <span class="vehicle-puck-stage">
        <span class="vehicle-heading-rotator">
          <span class="vehicle-anim vehicle-img-wrap${movingClass}" data-car="${model.id}" style="--car-map-w:${displaySize.width}px;--car-map-h:${displaySize.height}px;">
            ${effectHtml}
            ${renderVehicleVisual(model, displaySize)}
          </span>
        </span>
      </span>
    `;
  }

  window.CAR_MARKER_SIZE_CONFIG = CAR_MARKER_SIZE_CONFIG;
  window.CAR_MODELS = CAR_MODELS;
  window.getCarMapDisplaySize = getCarMapDisplaySize;
  window.injectCarAnimations = injectCarAnimations;
  window.syncCarMovingState = syncCarMovingState;
  window.syncCarHeading = syncCarHeading;
  window.getMyCarType = getMyCarType;
  window.setMyCarType = setMyCarType;
  window.getCarSvg = getCarSvg;
})();
