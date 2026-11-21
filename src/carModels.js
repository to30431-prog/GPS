// src/carModels.js
(function () {
  let stylesInjected = false;
  let lastAppliedHeading = 0;

  // baseAngle: 圖片基準朝向（正俯視圖且車頭朝上者設為 0）
  // 放大尺寸並搭配 CSS 鎖死，避免在路線預覽或重播容器中被壓縮
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
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        overflow: visible;
        user-select: none;
        -webkit-user-drag: none;
        transform-origin: 50% 50%;
      }
      .vehicle-nav-ring {
        display: none !important;
      }
      .vehicle-heading-rotator {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: visible;
        transform-origin: 50% 50%;
        transition: none;
        will-change: transform;
      }
      .vehicle-img-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: visible;
        transform-origin: 50% 50%;
      }
      .vehicle-img-wrap img {
        display: block;
        object-fit: contain;
        max-width: none !important;
        max-height: none !important;
        pointer-events: none;
        filter: drop-shadow(0 5px 8px rgba(15, 23, 42, 0.3));
      }
      /* 本機自車車標 (#my-puck / .my-car-marker / .nav-puck) 維持醒目大尺寸且盒模型正中對齊 */
      #my-puck .vehicle-puck-stage,
      #my-puck .vehicle-heading-rotator,
      #my-puck .vehicle-img-wrap,
      .my-car-marker .vehicle-puck-stage,
      .my-car-marker .vehicle-heading-rotator,
      .my-car-marker .vehicle-img-wrap {
        width: 80px;
        height: 80px;
      }
      #my-puck .vehicle-img-wrap img,
      .my-car-marker .vehicle-img-wrap img {
        width: 80px !important;
        height: 80px !important;
        max-width: 80px !important;
        max-height: 80px !important;
        object-fit: contain !important;
      }
      /* 車隊雷達隊友小車標 (.fleet-car-svg-wrap / .fleet-truck-marker) 強制限制在 48px，避免 124~140px 撐爆畫面或蓋住「開發者」等名稱標籤 */
      .fleet-car-svg-wrap .vehicle-puck-stage,
      .fleet-car-svg-wrap .vehicle-heading-rotator,
      .fleet-car-svg-wrap .vehicle-img-wrap,
      .fleet-truck-marker .vehicle-puck-stage,
      .fleet-truck-marker .vehicle-heading-rotator,
      .fleet-truck-marker .vehicle-img-wrap {
        width: 48px !important;
        height: 48px !important;
      }
      .fleet-car-svg-wrap .vehicle-img-wrap img,
      .fleet-truck-marker .vehicle-img-wrap img,
      .fleet-car-svg-wrap img {
        width: 48px !important;
        height: 48px !important;
        max-width: 48px !important;
        max-height: 48px !important;
        object-fit: contain !important;
      }
      /* 換車選單卡片內縮圖限制在合理預覽大小，避免撐爆選單 */
      button .vehicle-img-wrap img,
      .car-option .vehicle-img-wrap img,
      [data-car-select] .vehicle-img-wrap img,
      .car-picker-item .vehicle-img-wrap img,
      .vehicle-card .vehicle-img-wrap img {
        max-width: 72px !important;
        max-height: 72px !important;
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
      .vehicle-img-wrap.is-moving:not([data-car="turtle"]):not([data-car="thousand_sunny"]) img {
        animation: carDriveBounceTopDown 0.5s ease-in-out infinite;
      }
      /* 靜態與省電模式移除動畫 */
      .vehicle-img-wrap:not(.is-moving) img,
      body.power-saving .vehicle-img-wrap img {
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

  function syncCarMovingState(isMoving) {
    const pausedByPowerSave = document.body.classList.contains('power-saving');
    const active = Boolean(isMoving) && !pausedByPowerSave;

    document.querySelectorAll('#my-puck .vehicle-anim, #my-puck .vehicle-img-wrap, .my-car-marker .vehicle-anim, .my-car-marker .vehicle-img-wrap').forEach((el) => {
      el.classList.toggle('is-moving', active);
    });
  }

  // 依據地圖方位角與車頭方向即時同步旋轉（僅針對本機自車 #my-puck / .my-car-marker，不影響車隊雷達隊友）
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
    return `
      <span class="vehicle-puck-stage">
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
