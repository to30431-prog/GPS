// src/carModels.js
(function () {
  let stylesInjected = false;

  const CAR_MODELS = {
    garbage_yellow: {
      id: 'garbage_yellow',
      name: '經典清運車',
      svg: `
      <svg class="vehicle-anim" viewBox="0 0 120 150" width="68" height="86" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="m-gy-ground" cx="50%" cy="55%" r="50%">
            <stop offset="0%" stop-color="#0F172A" stop-opacity="0.34"/>
            <stop offset="70%" stop-color="#0F172A" stop-opacity="0.12"/>
            <stop offset="100%" stop-color="#0F172A" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="m-gy-top" x1="15%" y1="0%" x2="85%" y2="100%">
            <stop offset="0%" stop-color="#FEF08A"/>
            <stop offset="45%" stop-color="#FACC15"/>
            <stop offset="100%" stop-color="#CA8A04"/>
          </linearGradient>
          <linearGradient id="m-gy-side" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#EAB308"/>
            <stop offset="55%" stop-color="#B45309"/>
            <stop offset="100%" stop-color="#78350F"/>
          </linearGradient>
          <linearGradient id="m-gy-glass" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#E0F2FE"/>
            <stop offset="50%" stop-color="#38BDF8"/>
            <stop offset="100%" stop-color="#075985"/>
          </linearGradient>
          <linearGradient id="m-gy-metal" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#94A3B8"/>
            <stop offset="50%" stop-color="#475569"/>
            <stop offset="100%" stop-color="#1E293B"/>
          </linearGradient>
        </defs>

        <!-- 地面立體接觸陰影 -->
        <ellipse cx="62" cy="124" rx="42" ry="15" fill="url(#m-gy-ground)"/>

        <!-- 後輪組（立體輪胎厚度與輪框） -->
        <g>
          <path d="M22 92 C15 92 14 114 23 116 L31 114 C25 111 25 95 30 92 Z" fill="#1E293B" stroke="#090D16" stroke-width="2"/>
          <ellipse cx="21" cy="104" rx="4.5" ry="9" fill="#0F172A"/>
          <ellipse cx="21" cy="104" rx="2" ry="4.5" fill="#CBD5E1"/>
        </g>
        <g>
          <path d="M96 90 C103 90 104 110 95 112 L88 110 C93 107 93 93 89 90 Z" fill="#1E293B" stroke="#090D16" stroke-width="2"/>
          <ellipse cx="97" cy="101" rx="4" ry="8" fill="#0F172A"/>
        </g>

        <!-- 前輪組 -->
        <g>
          <path d="M24 38 C18 38 17 56 25 58 L32 56 C27 53 27 41 31 38 Z" fill="#1E293B" stroke="#090D16" stroke-width="2"/>
          <ellipse cx="23" cy="48" rx="4" ry="7.5" fill="#0F172A"/>
        </g>
        <g>
          <path d="M94 37 C100 37 101 54 93 56 L87 54 C91 51 91 40 88 37 Z" fill="#1E293B" stroke="#090D16" stroke-width="2"/>
          <ellipse cx="95" cy="46" rx="3.5" ry="7" fill="#0F172A"/>
        </g>

        <!-- 車身底盤厚度 -->
        <path d="M26 52 L92 40 L94 103 L64 120 L26 108 Z" fill="#451A03" opacity="0.55"/>

        <!-- 壓縮垃圾斗：立體側壁 + 頂蓋弧面 -->
        <path d="M26 48 L64 60 L64 114 L26 102 Z" fill="url(#m-gy-side)" stroke="#5C2D0C" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M64 60 L92 49 L92 101 L64 114 Z" fill="#92400E" stroke="#5C2D0C" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M26 48 L56 36 L92 49 L64 60 Z" fill="url(#m-gy-top)" stroke="#713F12" stroke-width="2.2" stroke-linejoin="round"/>

        <!-- 車斗側板加強筋與高光 -->
        <path d="M31 64 L59 73 M31 80 L59 89 M31 94 L59 103" stroke="#78350F" stroke-width="2.2" stroke-linecap="round" opacity="0.65"/>
        <path d="M33 49 L57 39 L84 49" fill="none" stroke="#FEF9C3" stroke-width="2" stroke-linecap="round" opacity="0.7"/>

        <!-- 車尾壓縮斗與警示燈條 -->
        <path d="M27 102 L64 114 L61 122 L29 111 Z" fill="#CA8A04" stroke="#5C2D0C" stroke-width="2"/>
        <rect x="33" y="107" width="8" height="4" rx="1" transform="skewY(18)" fill="#EF4444"/>
        <rect x="49" y="112" width="8" height="4" rx="1" transform="skewY(18)" fill="#EF4444"/>

        <!-- 車頭駕駛室：公仔式圓潤厚實造型 -->
        <path d="M28 18 C28 12 34 8 42 7 L64 4 C72 3 79 6 84 11 L90 17 L90 47 L64 59 L28 47 Z"
          fill="url(#m-gy-top)" stroke="#5C2D0C" stroke-width="2.4" stroke-linejoin="round"/>
        <!-- 駕駛室右側立體面 -->
        <path d="M64 26 L90 17 L90 47 L64 59 Z" fill="#D97706" stroke="#5C2D0C" stroke-width="2" stroke-linejoin="round"/>
        <!-- 駕駛室頂部高光 -->
        <path d="M35 13 L64 8 L81 15 L54 22 Z" fill="#FEF9C3" opacity="0.75"/>

        <!-- 立體弧形擋風玻璃 -->
        <path d="M34 18 C45 14 60 12 75 16 L71 29 C58 26 45 27 36 30 Z"
          fill="url(#m-gy-glass)" stroke="#0F172A" stroke-width="2" stroke-linejoin="round"/>
        <path d="M40 19 L55 16 L52 24 L38 26 Z" fill="#FFFFFF" opacity="0.45"/>

        <!-- 照後鏡 -->
        <rect x="20" y="24" width="9" height="6" rx="2.5" fill="url(#m-gy-metal)" stroke="#0F172A" stroke-width="1.6"/>
        <rect x="89" y="21" width="9" height="6" rx="2.5" fill="url(#m-gy-metal)" stroke="#0F172A" stroke-width="1.6"/>

        <!-- 前保險桿與頭燈 -->
        <path d="M28 43 L64 55 L90 44 L90 50 L64 62 L28 50 Z" fill="url(#m-gy-metal)" stroke="#0F172A" stroke-width="1.8"/>
        <ellipse cx="35" cy="41" rx="4" ry="2.5" fill="#FEF9C3" stroke="#92400E" stroke-width="1"/>
        <ellipse cx="57" cy="48" rx="4" ry="2.5" fill="#FEF9C3" stroke="#92400E" stroke-width="1"/>
      </svg>`
    },

    recycle_white: {
      id: 'recycle_white',
      name: '白藍資收車',
      svg: `
      <svg class="vehicle-anim" viewBox="0 0 120 150" width="68" height="86" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="m-rw-ground" cx="50%" cy="55%" r="50%">
            <stop offset="0%" stop-color="#0F172A" stop-opacity="0.32"/>
            <stop offset="100%" stop-color="#0F172A" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="m-rw-white" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#FFFFFF"/>
            <stop offset="60%" stop-color="#F1F5F9"/>
            <stop offset="100%" stop-color="#CBD5E1"/>
          </linearGradient>
          <linearGradient id="m-rw-blue" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#38BDF8"/>
            <stop offset="60%" stop-color="#0284C7"/>
            <stop offset="100%" stop-color="#0C4A6E"/>
          </linearGradient>
          <linearGradient id="m-rw-glass" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#E0F2FE"/>
            <stop offset="100%" stop-color="#0369A1"/>
          </linearGradient>
        </defs>

        <ellipse cx="62" cy="124" rx="42" ry="15" fill="url(#m-rw-ground)"/>

        <!-- 車輪 -->
        <ellipse cx="21" cy="104" rx="5" ry="10" fill="#1E293B" stroke="#090D16" stroke-width="2"/>
        <ellipse cx="97" cy="101" rx="4.5" ry="9" fill="#1E293B" stroke="#090D16" stroke-width="2"/>
        <ellipse cx="23" cy="48" rx="4.5" ry="8.5" fill="#1E293B" stroke="#090D16" stroke-width="2"/>
        <ellipse cx="95" cy="46" rx="4" ry="8" fill="#1E293B" stroke="#090D16" stroke-width="2"/>

        <!-- 資源回收立體貨斗 -->
        <path d="M26 48 L64 60 L64 114 L26 102 Z" fill="url(#m-rw-blue)" stroke="#0C4A6E" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M64 60 L92 49 L92 101 L64 114 Z" fill="#0369A1" stroke="#0C4A6E" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M26 48 L56 36 L92 49 L64 60 Z" fill="url(#m-rw-white)" stroke="#0284C7" stroke-width="2.2" stroke-linejoin="round"/>

        <!-- 貨斗內側淺藍層與橫桿 -->
        <path d="M30 56 L60 66 L60 107 L30 97 Z" fill="#E0F2FE" opacity="0.92"/>
        <path d="M30 70 L60 80 M30 84 L60 94" stroke="#0284C7" stroke-width="2" opacity="0.65"/>

        <!-- 環保標章徽章 -->
        <circle cx="45" cy="83" r="9.5" fill="#FFFFFF" stroke="#16A34A" stroke-width="2"/>
        <path d="M45 77 L49 84 L41 84 Z M40 86 L44 86 L42 90 Z M46 86 L50 86 L48 90 Z" fill="#16A34A"/>

        <!-- 白色立體駕駛室 -->
        <path d="M28 18 C28 12 34 8 42 7 L64 4 C72 3 79 6 84 11 L90 17 L90 47 L64 59 L28 47 Z"
          fill="url(#m-rw-white)" stroke="#334155" stroke-width="2.3" stroke-linejoin="round"/>
        <path d="M64 26 L90 17 L90 47 L64 59 Z" fill="#CBD5E1" stroke="#334155" stroke-width="2" stroke-linejoin="round"/>

        <!-- 擋風玻璃與藍色飾條 -->
        <path d="M34 18 C45 14 60 12 75 16 L71 29 C58 26 45 27 36 30 Z"
          fill="url(#m-rw-glass)" stroke="#0F172A" stroke-width="2"/>
        <path d="M28 43 L64 55 L90 44 L90 50 L64 62 L28 50 Z" fill="#0284C7" stroke="#0C4A6E" stroke-width="1.8"/>
      </svg>`
    },

    claw_truck: {
      id: 'claw_truck',
      name: '重型抓斗車',
      svg: `
      <svg class="vehicle-anim" viewBox="0 0 120 150" width="70" height="88" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="m-ct-ground" cx="50%" cy="55%" r="50%">
            <stop offset="0%" stop-color="#0F172A" stop-opacity="0.34"/>
            <stop offset="100%" stop-color="#0F172A" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="m-ct-orange" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#FDBA74"/>
            <stop offset="45%" stop-color="#EA580C"/>
            <stop offset="100%" stop-color="#7C2D12"/>
          </linearGradient>
          <linearGradient id="m-ct-arm" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#FEF08A"/>
            <stop offset="55%" stop-color="#EAB308"/>
            <stop offset="100%" stop-color="#A16207"/>
          </linearGradient>
        </defs>

        <ellipse cx="62" cy="125" rx="44" ry="15" fill="url(#m-ct-ground)"/>

        <!-- 重型輪胎 -->
        <ellipse cx="20" cy="105" rx="5.5" ry="11" fill="#1E293B" stroke="#090D16" stroke-width="2"/>
        <ellipse cx="98" cy="102" rx="5" ry="10" fill="#1E293B" stroke="#090D16" stroke-width="2"/>
        <ellipse cx="22" cy="48" rx="4.5" ry="9" fill="#1E293B" stroke="#090D16" stroke-width="2"/>
        <ellipse cx="96" cy="46" rx="4" ry="8" fill="#1E293B" stroke="#090D16" stroke-width="2"/>

        <!-- 重型貨斗本體 -->
        <path d="M24 48 L65 61 L65 115 L24 102 Z" fill="url(#m-ct-orange)" stroke="#431407" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M65 61 L94 49 L94 102 L65 115 Z" fill="#7C2D12" stroke="#431407" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M24 48 L56 35 L94 49 L65 61 Z" fill="#FDBA74" stroke="#7C2D12" stroke-width="2.2" stroke-linejoin="round"/>

        <!-- 貨斗內部深腔 -->
        <path d="M30 51 L56 41 L86 52 L63 62 Z" fill="#431407" opacity="0.65"/>

        <!-- 橘紅重卡駕駛室 -->
        <path d="M27 18 C27 12 33 8 41 7 L64 4 C72 3 79 6 84 11 L90 17 L90 47 L65 59 L27 47 Z"
          fill="url(#m-ct-orange)" stroke="#431407" stroke-width="2.3" stroke-linejoin="round"/>
        <path d="M34 18 C45 14 60 12 75 16 L71 29 C58 26 45 27 36 30 Z"
          fill="#1E293B" stroke="#0F172A" stroke-width="2"/>
        <path d="M40 19 L55 16 L52 23 L38 25 Z" fill="#38BDF8" opacity="0.45"/>

        <!-- 立體液壓抓斗臂與抓斗 -->
        <circle cx="58" cy="54" r="7" fill="#334155" stroke="#0F172A" stroke-width="2"/>
        <path d="M55 54 L65 51 L78 76 L69 80 Z" fill="url(#m-ct-arm)" stroke="#713F12" stroke-width="2" stroke-linejoin="round"/>
        <circle cx="73" cy="78" r="5" fill="#FACC15" stroke="#713F12" stroke-width="1.8"/>
        <!-- 抓斗爪 -->
        <path d="M71 82 L62 96 L67 101" fill="none" stroke="#1E293B" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M75 82 L84 95 L79 100" fill="none" stroke="#1E293B" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`
    },

    thousand_sunny: {
      id: 'thousand_sunny',
      name: '千陽號(破浪)',
      svg: `
      <svg class="vehicle-anim" viewBox="0 0 120 150" width="72" height="90" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="m-ts-sea" cx="50%" cy="62%" r="52%">
            <stop offset="0%" stop-color="#0284C7" stop-opacity="0.35"/>
            <stop offset="70%" stop-color="#38BDF8" stop-opacity="0.14"/>
            <stop offset="100%" stop-color="#38BDF8" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="m-ts-wood" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#FDE68A"/>
            <stop offset="45%" stop-color="#D97706"/>
            <stop offset="100%" stop-color="#78350F"/>
          </linearGradient>
          <linearGradient id="m-ts-sail" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#FFFFFF"/>
            <stop offset="75%" stop-color="#F1F5F9"/>
            <stop offset="100%" stop-color="#CBD5E1"/>
          </linearGradient>
        </defs>

        <!-- 水面波紋投影 -->
        <ellipse cx="60" cy="102" rx="44" ry="22" fill="url(#m-ts-sea)"/>

        <!-- 破浪動畫水花 -->
        <path class="sunny-wake-1" d="M22 106 Q40 122 60 110 Q80 98 98 110" fill="none" stroke="#38BDF8" stroke-width="3.8" stroke-linecap="round"/>
        <path class="sunny-wake-2" d="M16 115 Q38 131 60 120 Q82 108 104 120" fill="none" stroke="#E0F2FE" stroke-width="2.8" stroke-linecap="round"/>

        <!-- 立體船身（有龍骨與側舷厚度） -->
        <path d="M24 64 C24 88 38 112 60 124 C82 112 96 88 96 64 L84 56 L36 56 Z"
          fill="url(#m-ts-wood)" stroke="#451A03" stroke-width="2.5" stroke-linejoin="round"/>
        <!-- 船身右側深木陰影 -->
        <path d="M62 66 L96 64 C94 90 81 112 60 124 Z" fill="#92400E" opacity="0.55"/>

        <!-- 甲板與後甲板草皮 -->
        <path d="M26 62 L60 48 L94 62 L60 76 Z" fill="#FDE68A" stroke="#78350F" stroke-width="2"/>
        <ellipse cx="60" cy="86" rx="13" ry="8" fill="#22C55E" stroke="#14532D" stroke-width="1.8"/>
        <ellipse cx="58" cy="85" rx="8" ry="4" fill="#86EFAC" opacity="0.65"/>

        <!-- 船尾白帆與太陽徽章 -->
        <path d="M60 18 C38 26 26 40 26 56 L60 62 Z" fill="url(#m-ts-sail)" stroke="#78350F" stroke-width="2" stroke-linejoin="round"/>
        <path d="M60 18 C82 26 94 40 94 56 L60 62 Z" fill="#F8FAFC" stroke="#78350F" stroke-width="2" stroke-linejoin="round"/>
        <circle cx="60" cy="40" r="10" fill="#FACC15" stroke="#B45309" stroke-width="1.8"/>
        <path d="M60 32 L62 38 L68 40 L62 42 L60 48 L58 42 L52 40 L58 38 Z" fill="#EA580C"/>

        <!-- 桅杆 -->
        <rect x="58" y="14" width="4" height="58" rx="2" fill="#78350F"/>

        <!-- 獅子船首（辨識度核心：太陽鬃毛＋立體獅頭） -->
        <circle cx="60" cy="18" r="14" fill="#EA580C" stroke="#7C2D12" stroke-width="2"/>
        <path d="M60 2 L63 8 L69 5 L67 11 L74 11 L69 16 L75 20 L68 22 L70 28 L64 26 L60 32 L56 26 L50 28 L52 22 L45 20 L51 16 L46 11 L53 11 L51 5 L57 8 Z"
          fill="#FACC15" stroke="#92400E" stroke-width="1.2" stroke-linejoin="round"/>
        <circle cx="60" cy="18" r="8.5" fill="#FDE047" stroke="#92400E" stroke-width="1.5"/>
        <circle cx="57" cy="16" r="1.6" fill="#451A03"/>
        <circle cx="63" cy="16" r="1.6" fill="#451A03"/>
        <path d="M58 20 L62 20 L60 22 Z" fill="#9A3412"/>
        <path d="M56 23 Q60 26 64 23" fill="none" stroke="#451A03" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`
    },

    turtle: {
      id: 'turtle',
      name: '爬行綠蠵龜',
      svg: `
      <svg class="vehicle-anim" viewBox="0 0 120 150" width="70" height="88" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="m-tu-shadow" cx="50%" cy="55%" r="50%">
            <stop offset="0%" stop-color="#0F172A" stop-opacity="0.32"/>
            <stop offset="100%" stop-color="#0F172A" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="m-tu-dome" cx="38%" cy="32%" r="65%">
            <stop offset="0%" stop-color="#4ADE80"/>
            <stop offset="48%" stop-color="#16A34A"/>
            <stop offset="85%" stop-color="#15803D"/>
            <stop offset="100%" stop-color="#064E3B"/>
          </radialGradient>
          <linearGradient id="m-tu-limb" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#86EFAC"/>
            <stop offset="55%" stop-color="#22C55E"/>
            <stop offset="100%" stop-color="#15803D"/>
          </linearGradient>
        </defs>

        <!-- 地面陰影 -->
        <ellipse cx="60" cy="116" rx="42" ry="16" fill="url(#m-tu-shadow)"/>

        <!-- 後鰭肢（接點固定於龜殼後側，移動時划動） -->
        <g class="turtle-leg-bl">
          <path d="M35 92 C20 96 14 108 19 118 C24 124 36 114 44 98 Z"
            fill="url(#m-tu-limb)" stroke="#14532D" stroke-width="2.2" stroke-linejoin="round"/>
          <animateTransform class="turtle-anim-el" attributeName="transform" type="rotate"
            values="16 39 95; -16 39 95; 16 39 95" dur="0.55s" repeatCount="indefinite"/>
        </g>
        <g class="turtle-leg-br">
          <path d="M85 92 C100 96 106 108 101 118 C96 124 84 114 76 98 Z"
            fill="url(#m-tu-limb)" stroke="#14532D" stroke-width="2.2" stroke-linejoin="round"/>
          <animateTransform class="turtle-anim-el" attributeName="transform" type="rotate"
            values="-16 81 95; 16 81 95; -16 81 95" dur="0.55s" repeatCount="indefinite"/>
        </g>

        <!-- 前鰭肢（接點固定於龜殼前側，移動時划動） -->
        <g class="turtle-leg-fl">
          <path d="M36 52 C18 40 10 26 17 18 C24 12 36 26 44 46 Z"
            fill="url(#m-tu-limb)" stroke="#14532D" stroke-width="2.2" stroke-linejoin="round"/>
          <animateTransform class="turtle-anim-el" attributeName="transform" type="rotate"
            values="-20 40 49; 20 40 49; -20 40 49" dur="0.55s" repeatCount="indefinite"/>
        </g>
        <g class="turtle-leg-fr">
          <path d="M84 52 C102 40 110 26 103 18 C96 12 84 26 76 46 Z"
            fill="url(#m-tu-limb)" stroke="#14532D" stroke-width="2.2" stroke-linejoin="round"/>
          <animateTransform class="turtle-anim-el" attributeName="transform" type="rotate"
            values="20 80 49; -20 80 49; 20 80 49" dur="0.55s" repeatCount="indefinite"/>
        </g>

        <!-- 小尾巴 -->
        <path d="M55 107 L60 122 L65 107 Z" fill="#22C55E" stroke="#14532D" stroke-width="2" stroke-linejoin="round"/>

        <!-- 立體海龜頭部 -->
        <path d="M47 36 C45 20 50 10 60 10 C70 10 75 20 73 36 C68 41 52 41 47 36 Z"
          fill="url(#m-tu-limb)" stroke="#14532D" stroke-width="2.3" stroke-linejoin="round"/>
        <path d="M53 14 C57 12 63 12 67 14" fill="none" stroke="#DCFCE7" stroke-width="2.5" stroke-linecap="round" opacity="0.8"/>
        <circle cx="53" cy="21" r="3.4" fill="#FFFFFF"/>
        <circle cx="67" cy="21" r="3.4" fill="#FFFFFF"/>
        <circle cx="53.8" cy="21.5" r="1.9" fill="#052E16"/>
        <circle cx="67.8" cy="21.5" r="1.9" fill="#052E16"/>
        <circle cx="54.4" cy="20.7" r="0.8" fill="#FFFFFF"/>
        <circle cx="68.4" cy="20.7" r="0.8" fill="#FFFFFF"/>
        <path d="M56 30 Q60 33 64 30" fill="none" stroke="#14532D" stroke-width="1.6" stroke-linecap="round"/>

        <!-- 龜殼側面厚度裙邊 -->
        <ellipse cx="60" cy="75" rx="31" ry="37" fill="#052E16" stroke="#022C22" stroke-width="2.5"/>
        <!-- 拱形立體背甲 -->
        <ellipse cx="60" cy="72" rx="29.5" ry="35.5" fill="url(#m-tu-dome)" stroke="#86EFAC" stroke-width="2"/>

        <!-- 龜殼盾片立體稜線 -->
        <path d="M60 41 L72 52 L69 70 L60 77 L51 70 L48 52 Z"
          fill="#22C55E" fill-opacity="0.55" stroke="#BBF7D0" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M48 52 L34 58 L36 76 L51 70 Z" fill="#15803D" fill-opacity="0.45" stroke="#86EFAC" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M72 52 L86 58 L84 76 L69 70 Z" fill="#14532D" fill-opacity="0.45" stroke="#86EFAC" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M51 70 L69 70 L74 88 L60 101 L46 88 Z" fill="#166534" fill-opacity="0.5" stroke="#86EFAC" stroke-width="1.5" stroke-linejoin="round"/>

        <!-- 背甲頂部光澤高光 -->
        <path d="M42 52 C47 43 56 40 65 41" fill="none" stroke="#ECFDF5" stroke-width="3" stroke-linecap="round" opacity="0.65"/>
      </svg>`
    },

    sports_car: {
      id: 'sports_car',
      name: '赤紅超跑',
      svg: `
      <svg class="vehicle-anim" viewBox="0 0 120 150" width="66" height="84" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="m-sc-shadow" cx="50%" cy="55%" r="50%">
            <stop offset="0%" stop-color="#0F172A" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#0F172A" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="m-sc-paint" x1="15%" y1="0%" x2="85%" y2="100%">
            <stop offset="0%" stop-color="#FCA5A5"/>
            <stop offset="28%" stop-color="#EF4444"/>
            <stop offset="72%" stop-color="#B91C1C"/>
            <stop offset="100%" stop-color="#7F1D1D"/>
          </linearGradient>
          <linearGradient id="m-sc-canopy" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#38BDF8"/>
            <stop offset="45%" stop-color="#1E293B"/>
            <stop offset="100%" stop-color="#020617"/>
          </linearGradient>
        </defs>

        <ellipse cx="62" cy="123" rx="38" ry="14" fill="url(#m-sc-shadow)"/>

        <!-- 寬體四輪 -->
        <ellipse cx="23" cy="102" rx="5" ry="10" fill="#0F172A" stroke="#020617" stroke-width="2"/>
        <ellipse cx="97" cy="100" rx="4.5" ry="9" fill="#0F172A" stroke="#020617" stroke-width="2"/>
        <ellipse cx="25" cy="46" rx="4.5" ry="8.5" fill="#0F172A" stroke="#020617" stroke-width="2"/>
        <ellipse cx="95" cy="45" rx="4" ry="8" fill="#0F172A" stroke="#020617" stroke-width="2"/>

        <!-- 流線超跑立體車身 -->
        <path d="M30 42 C30 16 44 10 60 10 C76 10 90 16 90 42 L92 104 C92 116 78 122 60 122 C42 122 28 116 28 104 Z"
          fill="url(#m-sc-paint)" stroke="#450A0A" stroke-width="2.4" stroke-linejoin="round"/>
        <!-- 車身右側立體暗面 -->
        <path d="M64 11 C79 12 90 19 90 42 L92 104 C92 114 80 120 64 122 Z" fill="#7F1D1D" opacity="0.38"/>

        <!-- 雙賽車條紋 -->
        <path d="M53 11 L56 11 L54 121 L51 121 Z" fill="#FFFFFF" opacity="0.88"/>
        <path d="M62 11 L65 11 L63 121 L60 121 Z" fill="#FFFFFF" opacity="0.88"/>

        <!-- 圓潤流線座艙玻璃 -->
        <path d="M37 46 C48 34 72 34 83 46 L79 80 C68 88 52 88 41 80 Z"
          fill="url(#m-sc-canopy)" stroke="#0F172A" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M43 48 C52 40 68 40 77 48 L74 58 C65 53 55 53 46 58 Z" fill="#BAE6FD" opacity="0.45"/>

        <!-- 頭燈與碳纖維尾翼 -->
        <path d="M34 23 L45 18 L43 27 Z" fill="#FEF9C3"/>
        <path d="M86 23 L75 18 L77 27 Z" fill="#FEF9C3"/>
        <path d="M29 107 L91 107 L89 115 L31 115 Z" fill="#1E293B" stroke="#090D16" stroke-width="1.8"/>
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
  window.syncCarMovingState = syncCarMovingState;
  window.getMyCarType = getMyCarType;
  window.setMyCarType = setMyCarType;
  window.getCarSvg = getCarSvg;
})();
