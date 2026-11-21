// src/carModels.js
(function () {
  let stylesInjected = false;
  let lastAppliedHeading = 0;

  // baseAngle: 圖片基準朝向（正俯視圖且車頭朝上者設為 0）
  const CAR_MODELS = {
    garbage_yellow: {
      id: 'garbage_yellow',
      name: '經典清運車',
      src: './assets/cars/garbage_yellow.png',
      width: 64, // 略微放大以適應俯視視角
      height: 64,
      baseAngle: 0
    },
    recycle_white: {
      id: 'recycle_white',
      name: '白藍資收車',
      src: './assets/cars/recycle_white.png',
      width: 64,
      height: 64,
      baseAngle: 0
    },
    claw_truck: {
      id: 'claw_truck',
      name: '重型抓斗車',
      src: './assets/cars/claw_truck.png',
      width: 68,
      height: 68,
      baseAngle: 0
    },
    thousand_sunny: {
      id: 'thousand_sunny',
      name: '千陽號',
      src: './assets/cars/thousand_sunny.png',
      width: 72, // 船體較大，尺寸設定較高
      height: 72,
      baseAngle: 0
    },
    turtle: {
      id: 'turtle',
      name: '爬行綠蠵龜',
      src: './assets/cars/turtle.png',
      width: 68,
      height: 68,
      baseAngle: 0
    },
    sports_car: {
      id: 'sports_car',
      name: '赤紅超跑',
      src: './assets/cars/sports_car.png',
      width: 62, // 超跑流線型，比例設定
      height: 62,
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
        user-select: none;
        -webkit-user-drag: none;
      }
      /* 腳下導航底座光環 */
      .vehicle-nav-ring {
        position: absolute;
        width: 58px;
        height: 58px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(56, 189, 248, 0.28) 0%, rgba(14, 165, 233, 0.14) 65%, rgba(14, 165, 233, 0) 80%);
        border: 2.5px solid rgba(56, 189, 248, 0.75);
        box-shadow: 0 0 15px rgba(14, 165, 233, 0.45);
        pointer-events: none;
        z-index: 0;
        filter: drop-shadow(0 0 2px rgba(255,255,255,0.5));
      }
      /* 換車選單預覽時隱藏地圖光環 */
      button .vehicle-nav-ring,
      .car-option .vehicle-nav-ring,
      [data-car-select] .vehicle-nav-ring {
        display: none;
      }
      .vehicle-heading-rotator {
        position: relative;
        z-index: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        /* 平滑旋轉過渡，針對俯視圖優化 */
        transition: transform 0.35s cubic-bezier(0.21, 1.02, 0.33, 1);
        will-change: transform;
      }
      .vehicle-img-wrap {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .vehicle-img-wrap img {
        display: block;
        object-fit: contain;
        pointer-events: none;
        /* 移除舊陰影，改用圖片自帶陰影或下方疊加陰影層 */
        filter: drop-shadow(0 3px 5px rgba(15, 23, 42, 0.25));
      }
      /* 🐢 烏龜俯視划動 */
      .vehicle-img-wrap.is-moving[data-car="turtle"] img {
        animation: turtleWaddleTopDown 0.6s ease-in-out infinite alternate;
      }
      /* ☀️ 千陽號俯視破浪 */
      .vehicle-img-wrap.is-moving[data-car="thousand_sunny"] img {
        animation: sunnyBobTopDown 1.2s ease-in-out infinite;
      }
      /* 🚚💨 一般車輛俯視行駛輕微震動 */
      .vehicle-img-wrap.is-moving:not([data-car="turtle"]):not([data-car="thousand_sunny"] {
        animation: carDriveBounceTopDown 0.5s ease-in-out infinite;
      }
      /* 靜態與省電模式移除動畫 */
      .vehicle-img-wrap:not(.is-moving) img,
      body.power-saving .vehicle-img-wrap img {
        animation: none !important;
      }
      body.power-saving .vehicle-nav-ring {
        display: none;
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

  function syncCarMovingState(isMoving) {
    const pausedByPowerSave = document.body.classList.contains('power-saving');
    const active = Boolean(isMoving) && !pausedByPowerSave;

    document.querySelectorAll('.vehicle-anim, .vehicle-img-wrap').forEach((el) => {
      el.classList.toggle('is-moving', active);
    });
  }

  // 依據地圖方位角與車頭方向平滑旋轉（針對車頭朝上圖檔優化）
  function syncCarHeading(courseDeg, mapBearingDeg = 0) {
    if (typeof courseDeg !== 'number' || Number.isNaN(courseDeg)) return;

    const model = CAR_MODELS[getMyCarType()] || CAR_MODELS.garbage_yellow;
    const baseAngle = typeof model.baseAngle === 'number' ? model.baseAngle : 0;
    const target = courseDeg - (Number(mapBearingDeg) || 0) - baseAngle;

    // 最短路徑角度差，避免跨過 0/360 度時整圈倒轉
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
    return `
      <span class="vehicle-puck-stage">
        <span class="vehicle-nav-ring"></span>
        <span class="vehicle-heading-rotator">
          <span class="vehicle-anim vehicle-img-wrap${movingClass}" data-car="${model.id}">
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
