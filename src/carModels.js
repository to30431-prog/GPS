// src/carModels.js
(function () {
  let stylesInjected = false;
  let lastAppliedHeading = 0;

  // baseAngle: 圖片本身車頭朝向（左下45度圖示約 225 度；若改用正朝上圖檔則設為 0）
  const CAR_MODELS = {
    garbage_yellow: {
      id: 'garbage_yellow',
      name: '經典清運車',
      src: './assets/cars/garbage_yellow.png',
      width: 58,
      height: 58,
      baseAngle: 225
    },
    recycle_white: {
      id: 'recycle_white',
      name: '白藍資收車',
      src: './assets/cars/recycle_white.png',
      width: 58,
      height: 58,
      baseAngle: 225
    },
    claw_truck: {
      id: 'claw_truck',
      name: '重型抓斗車',
      src: './assets/cars/claw_truck.png',
      width: 60,
      height: 60,
      baseAngle: 225
    },
    thousand_sunny: {
      id: 'thousand_sunny',
      name: '千陽號',
      src: './assets/cars/thousand_sunny.png',
      width: 62,
      height: 62,
      baseAngle: 225
    },
    turtle: {
      id: 'turtle',
      name: '爬行綠蠵龜',
      src: './assets/cars/turtle.png',
      width: 60,
      height: 60,
      baseAngle: 225
    },
    sports_car: {
      id: 'sports_car',
      name: '赤紅超跑',
      src: './assets/cars/sports_car.png',
      width: 58,
      height: 58,
      baseAngle: 225
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
      /* 腳下導航底座光環（參考導航 App 質感） */
      .vehicle-nav-ring {
        position: absolute;
        width: 54px;
        height: 54px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(56, 189, 248, 0.26) 0%, rgba(14, 165, 233, 0.12) 62%, rgba(14, 165, 233, 0) 75%);
        border: 2px solid rgba(56, 189, 248, 0.72);
        box-shadow: 0 0 12px rgba(14, 165, 233, 0.35);
        pointer-events: none;
        z-index: 0;
      }
      /* 換車選單預覽時隱藏地圖光環，保持卡片清爽 */
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
        transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
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
        filter: drop-shadow(0 5px 7px rgba(15, 23, 42, 0.34));
      }
      .vehicle-img-wrap.is-moving[data-car="turtle"] img {
        animation: turtleWaddle 0.55s ease-in-out infinite alternate;
      }
      .vehicle-img-wrap.is-moving[data-car="thousand_sunny"] img {
        animation: sunnyBob 1.1s ease-in-out infinite;
      }
      .vehicle-img-wrap.is-moving:not([data-car="turtle"]):not([data-car="thousand_sunny"]) img {
        animation: carRollBounce 0.45s ease-in-out infinite;
      }
      .vehicle-img-wrap:not(.is-moving) img,
      body.power-saving .vehicle-img-wrap img {
        animation: none !important;
      }
      body.power-saving .vehicle-nav-ring {
        display: none;
      }
      @keyframes turtleWaddle {
        0%   { transform: rotate(-5deg) translateY(-1px); }
        100% { transform: rotate(5deg)  translateY(1px); }
      }
      @keyframes sunnyBob {
        0%, 100% { transform: translateY(0px) rotate(-2deg); }
        50%      { transform: translateY(-2.5px) rotate(2deg); }
      }
      @keyframes carRollBounce {
        0%, 100% { transform: translateY(0px); }
        50%      { transform: translateY(-1.5px); }
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

  // 依據地圖方位角與車頭方向平滑旋轉（支援「北朝上」與「車頭朝上」兩種模式）
  function syncCarHeading(courseDeg, mapBearingDeg = 0) {
    if (typeof courseDeg !== 'number' || Number.isNaN(courseDeg)) return;

    const model = CAR_MODELS[getMyCarType()] || CAR_MODELS.garbage_yellow;
    const baseAngle = typeof model.baseAngle === 'number' ? model.baseAngle : 225;
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
