// src/carModels.js
(function () {
  let stylesInjected = false;

  const CAR_MODELS = {
    garbage_yellow: {
      id: 'garbage_yellow',
      name: '經典清運車',
      src: './assets/cars/garbage_yellow.png',
      width: 58,
      height: 58
    },
    recycle_white: {
      id: 'recycle_white',
      name: '白藍資收車',
      src: './assets/cars/recycle_white.png',
      width: 58,
      height: 58
    },
    claw_truck: {
      id: 'claw_truck',
      name: '重型抓斗車',
      src: './assets/cars/claw_truck.png',
      width: 60,
      height: 60
    },
    thousand_sunny: {
      id: 'thousand_sunny',
      name: '千陽號',
      src: './assets/cars/thousand_sunny.png',
      width: 62,
      height: 62
    },
    turtle: {
      id: 'turtle',
      name: '爬行綠蠵龜',
      src: './assets/cars/turtle.png',
      width: 60,
      height: 60
    },
    sports_car: {
      id: 'sports_car',
      name: '赤紅超跑',
      src: './assets/cars/sports_car.png',
      width: 58,
      height: 58
    }
  };

  function injectCarAnimations() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'car-models-anim-style';
    style.textContent = `
      .vehicle-img-wrap {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        user-select: none;
        -webkit-user-drag: none;
      }
      .vehicle-img-wrap img {
        display: block;
        object-fit: contain;
        pointer-events: none;
        filter: drop-shadow(0 4px 6px rgba(15, 23, 42, 0.28));
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
    return `<span class="vehicle-anim vehicle-img-wrap${movingClass}" data-car="${model.id}"><img src="${model.src}" alt="${model.name}" width="${model.width}" height="${model.height}" loading="eager" /></span>`;
  }

  window.CAR_MODELS = CAR_MODELS;
  window.injectCarAnimations = injectCarAnimations;
  window.syncCarMovingState = syncCarMovingState;
  window.getMyCarType = getMyCarType;
  window.setMyCarType = setMyCarType;
  window.getCarSvg = getCarSvg;
})();
