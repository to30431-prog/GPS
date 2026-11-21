// src/carModels.js
(function () {
  let stylesInjected = false;

  const CAR_MODELS = {
    garbage_yellow: {
      id: 'garbage_yellow',
      name: '經典清運車',
      svg: `<svg viewBox="0 0 60 120" width="44" height="88" xmlns="http://www.w3.org/2000/svg">
        <rect x="10" y="10" width="40" height="100" rx="8" fill="#FACC15" stroke="#1E293B" stroke-width="3"/>
        <rect x="14" y="18" width="32" height="16" rx="4" fill="#38BDF8" stroke="#1E293B" stroke-width="2"/>
        <rect x="12" y="42" width="36" height="58" rx="3" fill="#EAB308" stroke="#1E293B" stroke-width="2"/>
        <path d="M12 102 L24 102 L20 110 L12 110 Z" fill="#EF4444"/>
        <path d="M48 102 L36 102 L40 110 L48 110 Z" fill="#EF4444"/>
        <polygon points="24,104 36,104 30,110" fill="#3B82F6"/>
      </svg>`
    },
    recycle_white: {
      id: 'recycle_white',
      name: '白藍資收車',
      svg: `<svg viewBox="0 0 60 120" width="44" height="88" xmlns="http://www.w3.org/2000/svg">
        <rect x="10" y="10" width="40" height="100" rx="8" fill="#F8FAFC" stroke="#0284C7" stroke-width="3"/>
        <rect x="14" y="18" width="32" height="16" rx="4" fill="#0EA5E9" stroke="#0F172A" stroke-width="2"/>
        <rect x="13" y="42" width="34" height="60" rx="2" fill="#E0F2FE" stroke="#0284C7" stroke-width="2"/>
        <line x1="13" y1="57" x2="47" y2="57" stroke="#0284C7" stroke-width="1.5"/>
        <line x1="13" y1="72" x2="47" y2="72" stroke="#0284C7" stroke-width="1.5"/>
        <line x1="13" y1="87" x2="47" y2="87" stroke="#0284C7" stroke-width="1.5"/>
        <circle cx="30" cy="26" r="3" fill="#22C55E"/>
      </svg>`
    },
    claw_truck: {
      id: 'claw_truck',
      name: '重型抓斗車',
      svg: `<svg viewBox="0 0 60 120" width="46" height="92" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="8" width="44" height="104" rx="6" fill="#EA580C" stroke="#1E293B" stroke-width="3"/>
        <rect x="13" y="14" width="34" height="15" rx="3" fill="#334155"/>
        <rect x="12" y="38" width="36" height="68" fill="#9A3412" stroke="#1E293B" stroke-width="2"/>
        <rect x="26" y="32" width="8" height="45" rx="3" fill="#FACC15" stroke="#000" stroke-width="2"/>
        <circle cx="30" cy="35" r="5" fill="#1E293B"/>
        <path d="M22 77 L30 88 L38 77" fill="none" stroke="#FACC15" stroke-width="3"/>
      </svg>`
    },
    thousand_sunny: {
      id: 'thousand_sunny',
      name: '千陽號(破浪)',
      svg: `<svg class="vehicle-anim" viewBox="0 0 60 130" width="50" height="106" xmlns="http://www.w3.org/2000/svg">
        <path class="sunny-wake-1" d="M16 98 Q30 112 44 98" fill="none" stroke="#38BDF8" stroke-width="3" stroke-linecap="round"/>
        <path class="sunny-wake-2" d="M12 104 Q30 122 48 104" fill="none" stroke="#BAE6FD" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M16 26 Q30 14 44 26 L46 92 Q30 108 14 92 Z" fill="#D97706" stroke="#451A03" stroke-width="2.5"/>
        <path d="M19 30 Q30 20 41 30 L42 88 Q30 100 18 88 Z" fill="#FDE68A"/>
        <ellipse cx="30" cy="78" rx="9" ry="12" fill="#22C55E" stroke="#15803D" stroke-width="1.5"/>
        <circle cx="30" cy="18" r="10" fill="#EA580C" stroke="#7C2D12" stroke-width="2"/>
        <circle cx="30" cy="17" r="6.5" fill="#FACC15" stroke="#7C2D12" stroke-width="1.5"/>
        <circle cx="24" cy="12" r="2.2" fill="#FACC15" stroke="#7C2D12" stroke-width="1"/>
        <circle cx="36" cy="12" r="2.2" fill="#FACC15" stroke="#7C2D12" stroke-width="1"/>
        <circle cx="30" cy="14" r="1.5" fill="#451A03"/>
        <rect x="13" y="46" width="34" height="10" rx="3" fill="#FFFFFF" stroke="#1E293B" stroke-width="2"/>
        <rect x="19" y="46" width="5" height="10" fill="#EF4444"/>
        <rect x="36" y="46" width="5" height="10" fill="#EF4444"/>
        <circle cx="30" cy="98" r="4" fill="#92400E" stroke="#451A03" stroke-width="1.5"/>
      </svg>`
    },
    turtle: {
      id: 'turtle',
      name: '爬行綠蠵龜',
      svg: `<svg class="vehicle-anim" viewBox="0 0 60 120" width="48" height="96" xmlns="http://www.w3.org/2000/svg">
        <g>
          <ellipse cx="13" cy="43" rx="5.5" ry="10" transform="rotate(-18 13 43)" fill="#4ADE80" stroke="#14532D" stroke-width="2"/>
          <animateTransform class="turtle-anim-el" attributeName="transform" type="rotate"
            values="-22 16 46; 22 16 46; -22 16 46" dur="0.55s" repeatCount="indefinite"/>
        </g>
        <g>
          <ellipse cx="47" cy="43" rx="5.5" ry="10" transform="rotate(18 47 43)" fill="#4ADE80" stroke="#14532D" stroke-width="2"/>
          <animateTransform class="turtle-anim-el" attributeName="transform" type="rotate"
            values="22 44 46; -22 44 46; 22 44 46" dur="0.55s" repeatCount="indefinite"/>
        </g>
        <g>
          <ellipse cx="14" cy="83" rx="4.8" ry="8.5" transform="rotate(15 14 83)" fill="#4ADE80" stroke="#14532D" stroke-width="2"/>
          <animateTransform class="turtle-anim-el" attributeName="transform" type="rotate"
            values="18 17 80; -18 17 80; 18 17 80" dur="0.55s" repeatCount="indefinite"/>
        </g>
        <g>
          <ellipse cx="46" cy="83" rx="4.8" ry="8.5" transform="rotate(-15 46 83)" fill="#4ADE80" stroke="#14532D" stroke-width="2"/>
          <animateTransform class="turtle-anim-el" attributeName="transform" type="rotate"
            values="-18 43 80; 18 43 80; -18 43 80" dur="0.55s" repeatCount="indefinite"/>
        </g>
        <ellipse cx="30" cy="18" rx="7" ry="10" fill="#22C55E" stroke="#14532D" stroke-width="2"/>
        <circle cx="27" cy="14" r="1.5" fill="#0F172A"/>
        <circle cx="33" cy="14" r="1.5" fill="#0F172A"/>
        <ellipse cx="30" cy="64" rx="18" ry="26" fill="#15803D" stroke="#052E16" stroke-width="2.5"/>
        <polygon points="30,46 39,55 36,72 24,72 21,55" fill="#16A34A" stroke="#86EFAC" stroke-width="1.5"/>
        <polygon points="27,90 33,90 30,100" fill="#22C55E" stroke="#14532D" stroke-width="1.5"/>
      </svg>`
    },
    sports_car: {
      id: 'sports_car',
      name: '赤紅超跑',
      svg: `<svg viewBox="0 0 60 120" width="42" height="84" xmlns="http://www.w3.org/2000/svg">
        <rect x="12" y="12" width="36" height="96" rx="14" fill="#DC2626" stroke="#111827" stroke-width="3"/>
        <path d="M16 32 Q30 22 44 32 L41 52 L19 52 Z" fill="#1E293B"/>
        <rect x="27" y="12" width="6" height="96" fill="#F8FAFC" opacity="0.85"/>
        <rect x="10" y="98" width="40" height="7" rx="2" fill="#111827"/>
      </svg>`
    }
  };

  function injectCarAnimations() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'car-models-anim-style';
    style.textContent = `
      .sunny-wake-1 {
        transform-box: fill-box;
        transform-origin: center top;
        animation: sunnyWakePulse 0.9s ease-out infinite;
      }
      .sunny-wake-2 {
        transform-box: fill-box;
        transform-origin: center top;
        animation: sunnyWakePulse 0.9s ease-out 0.45s infinite;
      }
      .vehicle-anim:not(.is-moving) .sunny-wake-1,
      .vehicle-anim:not(.is-moving) .sunny-wake-2,
      body.power-saving .vehicle-anim * {
        animation-play-state: paused !important;
      }
      .vehicle-anim:not(.is-moving) .sunny-wake-1,
      .vehicle-anim:not(.is-moving) .sunny-wake-2 {
        opacity: 0;
      }
      @keyframes sunnyWakePulse {
        0%   { opacity: 0.9; transform: scale(0.7, 0.6) translateY(0); }
        100% { opacity: 0;   transform: scale(1.45, 1.8) translateY(10px); }
      }
    `;
    document.head.appendChild(style);
  }

  function syncCarMovingState(isMoving) {
    const pausedByPowerSave = document.body.classList.contains('power-saving');
    const active = Boolean(isMoving) && !pausedByPowerSave;

    document.querySelectorAll('.vehicle-anim').forEach((svg) => {
      svg.classList.toggle('is-moving', active);
    });

    document.querySelectorAll('.turtle-anim-el').forEach((anim) => {
      try {
        if (active) {
          anim.beginElement();
        } else {
          anim.endElement();
        }
      } catch (_) {}
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
    const rawSvg = (CAR_MODELS[carTypeId] || CAR_MODELS.garbage_yellow).svg;
    return isMoving
      ? rawSvg.replace('class="vehicle-anim"', 'class="vehicle-anim is-moving"')
      : rawSvg;
  }

  window.CAR_MODELS = CAR_MODELS;
  window.injectCarAnimations = injectCarAnimations;
  window.getMyCarType = getMyCarType;
  window.setMyCarType = setMyCarType;
  window.getCarSvg = getCarSvg;
  window.syncCarMovingState = syncCarMovingState;
})();
