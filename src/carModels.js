// src/carModels.js
(function () {
  let stylesInjected = false;
  let lastAppliedHeading = 0;

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
    }
  };

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
      .vehicle-img-wrap img {
        position: relative;
        z-index: 2;
        display: block;
        object-fit: contain;
        max-width: none !important;
        max-height: none !important;
        pointer-events: none;
        filter: drop-shadow(0 5px 8px rgba(15, 23, 42, 0.3));
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
      .vehicle-img-wrap.is-moving:not([data-car="thousand_sunny"]):not([data-car="turtle"]) .car-exhaust-svg {
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

      /* 🐢 綠蠵龜移動殘影（Afterimage） */
      .turtle-afterimage {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        pointer-events: none;
        z-index: 1;
        opacity: 0;
        filter: saturate(1.2) brightness(1.08) drop-shadow(0 0 4px rgba(52, 211, 153, 0.45));
      }
      .vehicle-img-wrap.is-moving[data-car="turtle"] .turtle-afterimage-1 {
        animation: turtleTrailFade 0.85s ease-out infinite;
      }
      .vehicle-img-wrap.is-moving[data-car="turtle"] .turtle-afterimage-2 {
        animation: turtleTrailFade 0.85s ease-out 0.42s infinite;
      }
      @keyframes turtleTrailFade {
        0% {
          opacity: 0.48;
          transform: translateY(4px) scale(0.96);
        }
        100% {
          opacity: 0;
          transform: translateY(22px) scale(0.86);
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
      button .turtle-afterimage,
      .car-option .turtle-afterimage,
      [data-car-select] .turtle-afterimage,
      .car-picker-item .turtle-afterimage,
      .vehicle-card .turtle-afterimage,
      .fleet-car-svg-wrap .turtle-afterimage,
      .vehicle-img-wrap:not(.is-moving) .turtle-afterimage,
      body.power-saving .turtle-afterimage {
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
      .vehicle-img-wrap.is-moving[data-car="turtle"] > img:not(.turtle-afterimage) {
        animation: turtleWaddleTopDown 0.6s ease-in-out infinite alternate;
      }
      /* ☀️ 千陽號俯視破浪 */
      .vehicle-img-wrap.is-moving[data-car="thousand_sunny"] > img {
        animation: sunnyBobTopDown 1.2s ease-in-out infinite;
      }
      /* 🚚💨 一般車輛俯視行駛輕微震動 */
      .vehicle-img-wrap.is-moving:not([data-car="turtle"]):not([data-car="thousand_sunny"]) > img {
        animation: carDriveBounceTopDown 0.5s ease-in-out infinite;
      }
      /* 靜態與省電模式移除動畫 */
      .vehicle-img-wrap:not(.is-moving) > img,
      body.power-saving .vehicle-img-wrap > img {
        animation: none !important;
      }
      @keyframes turtleWaddleTopDown {
        0%   { transform: rotate(-4deg); }
        100% { transform: rotate(4deg); }
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
        <path class="sunny-bow-wave-1"
          d="M52 74 Q100 22 148 74"
          stroke="url(#sunnyWakeGrad)" stroke-width="5.5" stroke-linecap="round" />
        <path class="sunny-bow-wave-2"
          d="M42 90 Q100 30 158 90"
          stroke="#BAE6FD" stroke-width="3.5" stroke-linecap="round" />
        <path class="sunny-stern-wake-1"
          d="M66 154 Q100 176 134 154 M56 172 Q100 198 144 172"
          stroke="url(#sunnyWakeGrad)" stroke-width="5" stroke-linecap="round" />
        <path class="sunny-stern-wake-2"
          d="M60 186 Q100 214 140 186 M74 204 Q100 226 126 204"
          stroke="#E0F2FE" stroke-width="3.5" stroke-linecap="round" />
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

  function getTurtleAfterimageHtml(model) {
    return `
      <img class="turtle-afterimage turtle-afterimage-1" src="${model.src}" alt="" width="${model.width}" height="${model.height}" aria-hidden="true" />
      <img class="turtle-afterimage turtle-afterimage-2" src="${model.src}" alt="" width="${model.width}" height="${model.height}" aria-hidden="true" />
    `;
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
      effectHtml = getTurtleAfterimageHtml(model);
    } else {
      effectHtml = getCarExhaustSvg();
    }

    return `
      <span class="vehicle-puck-stage">
        <span class="vehicle-heading-rotator">
          <span class="vehicle-anim vehicle-img-wrap${movingClass}" data-car="${model.id}">
            ${effectHtml}
            <img src="${model.src}" alt="${model.name}" width="${model.width}" height="${model.height}" loading="eager" />
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
