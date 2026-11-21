// src/carModels.js
(function () {
  let stylesInjected = false;

  const CAR_MODELS = {
    // 1. 經典清運車（正俯視立體質感版）
    garbage_yellow: {
      id: 'garbage_yellow',
      name: '經典清運車',
      svg: `
      <svg class="vehicle-anim" viewBox="0 0 100 140" width="60" height="84" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="gy-cab" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#FDE047"/><stop offset="0.5" stop-color="#FACC15"/><stop offset="1" stop-color="#CA8A04"/>
          </linearGradient>
          <linearGradient id="gy-box" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#EAB308"/><stop offset="0.5" stop-color="#FACC15"/><stop offset="1" stop-color="#A16207"/>
          </linearGradient>
        </defs>
        <!-- 投影 -->
        <rect x="24" y="14" width="56" height="116" rx="12" fill="#0F172A" opacity="0.25"/>
        <!-- 四輪外露 -->
        <rect x="17" y="28" width="7" height="18" rx="3" fill="#1E293B"/>
        <rect x="76" y="28" width="7" height="18" rx="3" fill="#1E293B"/>
        <rect x="17" y="96" width="7" height="20" rx="3" fill="#1E293B"/>
        <rect x="76" y="96" width="7" height="20" rx="3" fill="#1E293B"/>
        <!-- 照後鏡 -->
        <rect x="13" y="22" width="8" height="5" rx="2" fill="#334155"/>
        <rect x="79" y="22" width="8" height="5" rx="2" fill="#334155"/>
        <!-- 車頭駕駛室 -->
        <rect x="22" y="10" width="56" height="36" rx="10" fill="url(#gy-cab)" stroke="#713F12" stroke-width="2.5"/>
        <!-- 前擋風玻璃 -->
        <path d="M27 18 Q50 13 73 18 L70 30 Q50 27 30 30 Z" fill="#0284C7" stroke="#0F172A" stroke-width="2"/>
        <path d="M31 19 Q50 16 68 19 L66 23 Q50 21 33 23 Z" fill="#BAE6FD" opacity="0.7"/>
        <!-- 頭燈 -->
        <rect x="25" y="10" width="9" height="4" rx="2" fill="#FEF9C3"/>
        <rect x="66" y="10" width="9" height="4" rx="2" fill="#FEF9C3"/>
        <!-- 垃圾壓縮車斗 -->
        <rect x="20" y="46" width="60" height="72" rx="6" fill="url(#gy-box)" stroke="#713F12" stroke-width="2.5"/>
        <rect x="26" y="52" width="48" height="58" rx="4" fill="#EAB308" stroke="#A16207" stroke-width="1.5"/>
        <line x1="26" y1="68" x2="74" y2="68" stroke="#A16207" stroke-width="2"/>
        <line x1="26" y1="84" x2="74" y2="84" stroke="#A16207" stroke-width="2"/>
        <line x1="26" y1="98" x2="74" y2="98" stroke="#A16207" stroke-width="2"/>
        <!-- 車尾壓縮斗與紅藍警示條 -->
        <path d="M22 118 L78 118 L74 128 L26 128 Z" fill="#CA8A04" stroke="#713F12" stroke-width="2"/>
        <rect x="26" y="121" width="14" height="5" rx="1" fill="#EF4444"/>
        <rect x="60" y="121" width="14" height="5" rx="1" fill="#EF4444"/>
        <polygon points="44,121 56,121 50,127" fill="#3B82F6"/>
      </svg>`
    },

    // 2. 白藍資收車（正俯視立體質感版）
    recycle_white: {
      id: 'recycle_white',
      name: '白藍資收車',
      svg: `
      <svg class="vehicle-anim" viewBox="0 0 100 140" width="60" height="84" xmlns="http://www.w3.org/2000/svg">
        <rect x="24" y="14" width="56" height="116" rx="12" fill="#0F172A" opacity="0.22"/>
        <rect x="17" y="28" width="7" height="18" rx="3" fill="#1E293B"/>
        <rect x="76" y="28" width="7" height="18" rx="3" fill="#1E293B"/>
        <rect x="17" y="96" width="7" height="20" rx="3" fill="#1E293B"/>
        <rect x="76" y="96" width="7" height="20" rx="3" fill="#1E293B"/>
        <rect x="13" y="22" width="8" height="5" rx="2" fill="#334155"/>
        <rect x="79" y="22" width="8" height="5" rx="2" fill="#334155"/>
        <!-- 白色車頭 -->
        <rect x="22" y="10" width="56" height="36" rx="10" fill="#F8FAFC" stroke="#0369A1" stroke-width="2.5"/>
        <path d="M27 18 Q50 13 73 18 L70 30 Q50 27 30 30 Z" fill="#0EA5E9" stroke="#0C4A6E" stroke-width="2"/>
        <path d="M31 19 Q50 16 68 19 L66 23 Q50 21 33 23 Z" fill="#E0F2FE" opacity="0.8"/>
        <!-- 藍色圍欄貨斗 -->
        <rect x="20" y="46" width="60" height="80" rx="6" fill="#0284C7" stroke="#0C4A6E" stroke-width="2.5"/>
        <rect x="25" y="51" width="50" height="70" rx="3" fill="#E0F2FE" stroke="#0369A1" stroke-width="1.5"/>
        <!-- 貨斗橫桿與資源回收綠標 -->
        <line x1="25" y1="68" x2="75" y2="68" stroke="#38BDF8" stroke-width="2"/>
        <line x1="25" y1="86" x2="75" y2="86" stroke="#38BDF8" stroke-width="2"/>
        <line x1="25" y1="104" x2="75" y2="104" stroke="#38BDF8" stroke-width="2"/>
        <circle cx="50" cy="86" r="11" fill="#FFFFFF" stroke="#16A34A" stroke-width="2"/>
        <polygon points="50,79 56,89 44,89" fill="none" stroke="#16A34A" stroke-width="2.2"/>
      </svg>`
    },

    // 3. 重型抓斗車（正俯視＋機械臂版）
    claw_truck: {
      id: 'claw_truck',
      name: '重型抓斗車',
      svg: `
      <svg class="vehicle-anim" viewBox="0 0 100 140" width="62" height="86" xmlns="http://www.w3.org/2000/svg">
        <rect x="23" y="14" width="58" height="118" rx="10" fill="#0F172A" opacity="0.25"/>
        <rect x="16" y="28" width="7" height="18" rx="3" fill="#1E293B"/>
        <rect x="77" y="28" width="7" height="18" rx="3" fill="#1E293B"/>
        <rect x="16" y="96" width="7" height="22" rx="3" fill="#1E293B"/>
        <rect x="77" y="96" width="7" height="22" rx="3" fill="#1E293B"/>
        <!-- 橘紅重卡車頭 -->
        <rect x="21" y="10" width="58" height="35" rx="9" fill="#EA580C" stroke="#7C2D12" stroke-width="2.5"/>
        <path d="M26 17 Q50 12 74 17 L71 29 Q50 26 29 29 Z" fill="#1E293B" stroke="#0F172A" stroke-width="2"/>
        <!-- 重型貨斗 -->
        <rect x="19" y="45" width="62" height="82" rx="5" fill="#9A3412" stroke="#431407" stroke-width="2.5"/>
        <rect x="24" y="50" width="52" height="72" rx="3" fill="#7C2D12"/>
        <!-- 黃色液壓抓斗臂 -->
        <circle cx="50" cy="52" r="8" fill="#FACC15" stroke="#422006" stroke-width="2"/>
        <rect x="45" y="52" width="10" height="44" rx="4" fill="#FACC15" stroke="#422006" stroke-width="2"/>
        <!-- 四爪抓斗 -->
        <path d="M38 94 L50 108 L62 94" fill="none" stroke="#334155" stroke-width="4" stroke-linecap="round"/>
        <path d="M42 92 L50 104 L58 92" fill="none" stroke="#94A3B8" stroke-width="2.5" stroke-linecap="round"/>
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
    // 6. 赤紅超跑（流線俯視超跑版）
    sports_car: {
      id: 'sports_car',
      name: '赤紅超跑',
      svg: `
      <svg class="vehicle-anim" viewBox="0 0 100 140" width="58" height="82" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="sc-red" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#B91C1C"/><stop offset="0.5" stop-color="#EF4444"/><stop offset="1" stop-color="#991B1B"/>
          </linearGradient>
        </defs>
        <rect x="25" y="14" width="54" height="114" rx="22" fill="#0F172A" opacity="0.28"/>
        <!-- 寬體四輪 -->
        <rect x="18" y="30" width="7" height="18" rx="3" fill="#0F172A"/>
        <rect x="75" y="30" width="7" height="18" rx="3" fill="#0F172A"/>
        <rect x="18" y="92" width="7" height="20" rx="3" fill="#0F172A"/>
        <rect x="75" y="92" width="7" height="20" rx="3" fill="#0F172A"/>
        <!-- 流線車身 -->
        <path d="M24 34 Q24 10 50 10 Q76 10 76 34 L78 106 Q78 124 50 124 Q22 124 22 106 Z"
          fill="url(#sc-red)" stroke="#450A0A" stroke-width="2.5"/>
        <!-- 雙白賽車條紋 -->
        <rect x="44" y="11" width="4" height="112" fill="#FFFFFF" opacity="0.85"/>
        <rect x="52" y="11" width="4" height="112" fill="#FFFFFF" opacity="0.85"/>
        <!-- 駕駛座艙玻璃 -->
        <path d="M30 44 Q50 32 70 44 L66 78 Q50 84 34 78 Z" fill="#0F172A" stroke="#334155" stroke-width="2"/>
        <path d="M34 46 Q50 37 66 46 L63 56 Q50 52 37 56 Z" fill="#38BDF8" opacity="0.55"/>
        <!-- 頭燈與碳纖維大尾翼 -->
        <path d="M27 20 L36 16 L34 24 Z" fill="#FEF08A"/>
        <path d="M73 20 L64 16 L66 24 Z" fill="#FEF08A"/>
        <rect x="20" y="116" width="60" height="8" rx="3" fill="#0F172A" stroke="#334155" stroke-width="1.5"/>
      </svg>`
    }

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
