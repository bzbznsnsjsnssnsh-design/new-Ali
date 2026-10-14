export interface GeminiVoicePreset {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  prompt: string;
  iconName: string;
  recommendedVoices: string[];
}

export const GEMINI_VOICE_PRESETS: GeminiVoicePreset[] = [
  {
    id: "manhwa_narrator",
    name: "راوي المانهوا الملحمي",
    nameEn: "Manhwa Narrator",
    description: "النمط الافتراضي الفائق: سرد عربي طبيعي ومتفاعل مع تقلبات المشهد وتصاعد الأحداث.",
    prompt:
      "Natural Arabic manhwa narration. Speak clearly and naturally with expressive emotion appropriate to the scene. Use dramatic pacing during intense scenes, softer delivery during emotional scenes, and controlled serious delivery during dark scenes. Keep pronunciation clear and natural. Do not add, remove, summarize, or invent information.",
    iconName: "BookOpen",
    recommendedVoices: ["Achernar", "Zephyr", "Aoede"],
  },
  {
    id: "narrator",
    name: "راوي كلاسيكي متزن",
    nameEn: "Narrator",
    description: "إلقاء نثري وقور وموضوعي مناسب للسرد القصصي الكلاسيكي.",
    prompt:
      "Polite, authoritative and clear Arabic narration. Balanced cadence, natural pauses, articulate diction with steady pacing.",
    iconName: "Mic",
    recommendedVoices: ["Achernar", "Leda", "Zephyr"],
  },
  {
    id: "dramatic",
    name: "درامي ملحمي",
    nameEn: "Dramatic",
    description: "نبرة مشدودة وعاطفية تسلط الضوء على صلب الموقف المصيري.",
    prompt:
      "High emotional gravity, cinematic Arabic dramatic delivery. Rich resonant timbre with deliberate dramatic tension.",
    iconName: "Sparkles",
    recommendedVoices: ["Achernar", "Aoede", "Gacrux"],
  },
  {
    id: "dark_fantasy",
    name: "فانتازيا مظلمة",
    nameEn: "Dark Fantasy",
    description: "أجواء قاتمة وغامضة، وقفة عميقة ومشاعر مكبوتة.",
    prompt:
      "Deep dramatic male narration. Dark fantasy atmosphere. Serious and controlled emotion. Natural pauses. Clear Arabic pronunciation. Do not sound robotic.",
    iconName: "Moon",
    recommendedVoices: ["Achernar", "Charon", "Rasalgethi"],
  },
  {
    id: "serious",
    name: "جاد وصارم",
    nameEn: "Serious",
    description: "نبرة عسكرية حازمة تخلو من التردد، موجهة للأوامر والتحذيرات.",
    prompt:
      "Stern, resolute, no-nonsense Arabic voice. Firm cadence, precise consonants, commanding authority.",
    iconName: "Shield",
    recommendedVoices: ["Enceladus", "Schedar", "Orus"],
  },
  {
    id: "emotional",
    name: "عاطفي مؤثر",
    nameEn: "Emotional",
    description: "نبرة مشحونة بالشجن والأحاسيس الإنسانية الصادقة.",
    prompt:
      "Tender, poignant Arabic voice. Vulnerable nuance, heartfelt inflection, gentle breath pacing.",
    iconName: "Heart",
    recommendedVoices: ["Aoede", "Autonoe", "Vindemiatrix"],
  },
  {
    id: "sad",
    name: "حزين وكئيب",
    nameEn: "Sad",
    description: "نبرة مكسورة تعبر عن الفقدان والأسى والألم العميق.",
    prompt:
      "Melancholy, somber Arabic voice. Slow subdued pacing, weighted sigh inflections, soft fading cadences.",
    iconName: "CloudRain",
    recommendedVoices: ["Autonoe", "Aoede", "Umbriel"],
  },
  {
    id: "angry",
    name: "غاضب ومشتعل",
    nameEn: "Angry",
    description: "حدة انفعالية قاطعة، تصاعد نبرة الغضب والانتقام.",
    prompt:
      "Furious, intense Arabic voice. Sharp aggressive cadence, clenched-teeth undertone, rapid forceful delivery.",
    iconName: "Flame",
    recommendedVoices: ["Fenrir", "Rasalgethi", "Zubenelgenubi"],
  },
  {
    id: "whisper",
    name: "همس وسرية",
    nameEn: "Whisper",
    description: "همس حذر منخفض النبرة لمشاهد التسلل والمؤامرات الخفية.",
    prompt:
      "Hushed whispering Arabic tone. Intimate quiet airflow, stealthy confidential pacing, razor-sharp soft clarity.",
    iconName: "VolumeX",
    recommendedVoices: ["Callirrhoe", "Umbriel", "Despina"],
  },
  {
    id: "horror",
    name: "رعب وخوف",
    nameEn: "Horror",
    description: "ارتجاف خفيف وترقب قاتل للمشاهد المخيفة والمخلوقات المرعبة.",
    prompt:
      "Eerie, chilling Arabic voice. Unsettling erratic pauses, trembling undertone, cold sinister whisper dynamics.",
    iconName: "Skull",
    recommendedVoices: ["Charon", "Zubenelgenubi", "Umbriel"],
  },
  {
    id: "suspense",
    name: "تشويق وإثارة",
    nameEn: "Suspense",
    description: "نبض متسارع وترقب لما سيحدث في اللحظة التالية.",
    prompt:
      "High suspense thrilling Arabic delivery. Fast-building anticipation, sudden sharp pauses, energetic vigilance.",
    iconName: "Zap",
    recommendedVoices: ["Achernar", "Fenrir", "Algieba"],
  },
  {
    id: "battle",
    name: "معركة وقتال",
    nameEn: "Battle",
    description: "صيحات قتالية ووتيرة حامية وسط دوي المعارك.",
    prompt:
      "Adrenaline-fueled combat Arabic voice. Roaring heroic conviction, rapid-fire urgency, thunderous projection.",
    iconName: "Swords",
    recommendedVoices: ["Fenrir", "Enceladus", "Algieba"],
  },
  {
    id: "mysterious",
    name: "غموض وألغاز",
    nameEn: "Mysterious",
    description: "إيحاءات غامضة ونبرة فلسفية تبحث في طيات الأسرار.",
    prompt:
      "Enigmatic, hypnotic Arabic tone. Cryptic pacing, curious inquisitive cadence, veiled layered nuance.",
    iconName: "Eye",
    recommendedVoices: ["Despina", "Charon", "Laomedeia"],
  },
  {
    id: "romantic",
    name: "رومانسي دافئ",
    nameEn: "Romantic",
    description: "حميمية دافئة ونبرة ناعمة للحظات التقارب العاطفي.",
    prompt:
      "Warm, affectionate, gently captivating Arabic tone. Soft velvety modulation, tender melodic delivery.",
    iconName: "Smile",
    recommendedVoices: ["Algenib", "Aoede", "Autonoe"],
  },
  {
    id: "comedy",
    name: "كوميدي ومرح",
    nameEn: "Comedy",
    description: "نبرة ساخرة خفيفة مليئة بالمرح والمفاجآت المضحكة.",
    prompt:
      "Playful, whimsical, sarcastic Arabic voice. Bouncy rhythm, exaggerated comedic timing, cheerful lightness.",
    iconName: "Laugh",
    recommendedVoices: ["Puck", "Kore", "Sadaltager"],
  },
  {
    id: "calm",
    name: "هادئ ومطمئن",
    nameEn: "Calm",
    description: "راحة نفسية واستقرار صوتي للتأمل والاسترخاء وقراءة النصوص اليومية.",
    prompt:
      "Serene, tranquil, soothing Arabic voice. Relaxed natural rhythm, steady gentle breathing, comforting cadence.",
    iconName: "Feather",
    recommendedVoices: ["Zephyr", "Erinome", "Callirrhoe"],
  },
  {
    id: "excited",
    name: "متحمس ومبتهج",
    nameEn: "Excited",
    description: "طاقة فياضة وسعادة بالغة باكتشاف جديد أو انتصار باهر.",
    prompt:
      "Exuberant, radiant, joyful Arabic tone. Fast lively tempo, bright sparkling pitch, triumphant cheerfulness.",
    iconName: "Sun",
    recommendedVoices: ["Sulafat", "Kore", "Algieba"],
  },
];
