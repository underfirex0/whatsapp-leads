import type { CallbackTime, Lang } from '../types';

/**
 * Every bot message lives here so wording can be reviewed (and later
 * translated or moved to WhatsApp message templates) without touching logic.
 * `null` language = the customer has not written yet → bilingual message.
 */
type L = Lang | null;
const bi = (fr: string, ar: string, lang: L) => (lang === 'ar' ? ar : lang === 'fr' ? fr : `${fr}\n\n${ar}`);
const pick = (fr: string, ar: string, lang: L) => (lang === 'ar' ? ar : fr);

export const ENTRY_TEMPLATE = (company: string, city: string) =>
  `Bonjour, je vous contacte via Telecontact au sujet de ${company} à ${city}. Pouvez-vous me répondre rapidement ?`;

export const ENTRY_TEMPLATE_RE = /je vous contacte via telecontact au sujet de (.+?) a (.+?)\.\s*pouvez-vous/i;

export const copy = {
  welcome: () =>
    'Bonjour 👋\nMerci pour votre message.\nDites-nous en 1 clic ce dont vous avez besoin :\n1️⃣ Prix\n2️⃣ Infos\n3️⃣ Être rappelé\n\n' +
    'مرحبًا 👋\nشكرًا على رسالتكم.\nأخبرونا بنقرة واحدة بما تحتاجونه:\n1️⃣ السعر\n2️⃣ المعلومات\n3️⃣ أريد أن يتم الاتصال بي',

  intentButtons: [
    { id: 'intent:PRICE', label: '1️⃣ Prix / السعر' },
    { id: 'intent:INFO', label: '2️⃣ Infos / المعلومات' },
    { id: 'intent:CALLBACK', label: '3️⃣ Être rappelé / اتصلوا بي' },
  ],

  consent: (url: string) =>
    `Merci.\nPour vous mettre en relation avec cette entreprise ou d’autres professionnels capables de répondre tout de suite à votre besoin, cliquez sur OK.\nDonnées personnelles : ${url}\n\n` +
    `شكرًا.\nلربطكم بهذه الشركة أو بمهنيين آخرين قادرين على الاستجابة لطلبكم فورًا، اضغطوا على موافق.\nالبيانات الشخصية: ${url}`,

  consentButtons: [
    { id: 'consent:yes', label: 'OK / موافق' },
    { id: 'consent:no', label: 'Non / لا' },
  ],

  refused: (lang: L) =>
    bi(
      'C’est noté, nous ne collecterons aucune information personnelle.\nMerci d’avoir utilisé Telecontact. Vous pouvez toujours consulter la fiche de l’entreprise sur telecontact.ma.',
      'تم تسجيل اختياركم، لن نجمع أي معلومات شخصية.\nشكرًا لاستخدامكم تيليكونتاكت.',
      lang,
    ),

  askName: (lang: L) =>
    bi(
      'Merci ! On traite votre demande très vite.\nPouvez-vous nous communiquer votre nom et prénom ?',
      'شكرًا! نحن نعالج طلبكم بسرعة.\nهل يمكنكم تزويدنا بالاسم الشخصي والعائلي؟',
      lang,
    ),

  invalidName: (lang: L) =>
    pick(
      'Je n’ai pas bien saisi votre nom 🙂 Pouvez-vous l’écrire en toutes lettres ? (ex. : Ahmed El Amrani)',
      'لم أفهم الاسم جيدًا 🙂 المرجو كتابته بالحروف (مثال: أحمد العمراني)',
      lang,
    ),

  confirmPhone: (lang: L, first: string, phone: string) =>
    pick(
      `Merci ${first}.\nPeut-on vous joindre sur ce numéro WhatsApp : ${phone} ?`,
      `شكرًا ${first}.\nهل يمكننا الاتصال بكم على هذا الرقم: ${phone}؟`,
      lang,
    ),

  phoneButtons: (lang: L) => [
    { id: 'phone:confirm', label: pick('Confirmer ce numéro', 'تأكيد هذا الرقم', lang) },
    { id: 'phone:other', label: pick('Utiliser un autre numéro', 'استعمال رقم آخر', lang) },
  ],

  askPhone: (lang: L) =>
    pick('Quel numéro devons-nous utiliser ? (ex. : 06 61 23 45 67)', 'ما هو الرقم الذي نستعمله؟ (مثال: 06 61 23 45 67)', lang),

  invalidPhone: (lang: L) =>
    pick(
      'Ce numéro ne semble pas valide. Merci d’indiquer un numéro marocain (06…, 07…, 05… ou +212…).',
      'هذا الرقم غير صالح. المرجو إدخال رقم مغربي (06… أو 07… أو 05… أو +212…).',
      lang,
    ),

  askProduct: (lang: L, company: string) =>
    pick(
      `Parfait.\nQuel produit ou service recherchez-vous chez ${company} ?`,
      `ممتاز.\nما هو المنتج أو الخدمة التي تبحثون عنها لدى ${company}؟`,
      lang,
    ),

  askQuantity: (lang: L, product: string) =>
    pick(`Bien noté : ${product}.\nCombien d’unités vous faut-il ?`, `تم: ${product}.\nكم عدد الوحدات التي تحتاجونها؟`, lang),

  quantityButtons: [
    { id: 'qty:1', label: '1' },
    { id: 'qty:2', label: '2' },
    { id: 'qty:3', label: '3 ou plus' },
  ],

  invalidQuantity: (lang: L) =>
    pick('Merci d’indiquer une quantité en chiffres (ex. : 2).', 'المرجو كتابة الكمية بالأرقام (مثال: 2).', lang),

  askLocation: (lang: L) =>
    pick('Dans quelle ville faut-il livrer ou intervenir ?', 'في أي مدينة يجب التوصيل أو التدخل؟', lang),

  locationButtons: (city: string | null, lang: L) =>
    [
      ...(city ? [{ id: 'loc:fiche', label: city }] : []),
      { id: 'loc:other', label: pick('Autre ville', 'مدينة أخرى', lang) },
    ],

  askOtherCity: (lang: L) => pick('Quelle ville ?', 'أي مدينة؟', lang),

  invalidCity: (lang: L) =>
    pick('Je n’ai pas reconnu la ville. Pouvez-vous la préciser ?', 'لم أتعرف على المدينة. هل يمكنكم توضيحها؟', lang),

  askDetails: (lang: L) =>
    pick(
      'Une précision utile pour le professionnel (modèle, délai, budget…) ? Sinon, appuyez sur « Passer ».',
      'هل هناك تفاصيل مفيدة (النموذج، الأجل، الميزانية…)؟ وإلا اضغطوا على «تخطي».',
      lang,
    ),

  detailsButtons: (lang: L) => [{ id: 'details:skip', label: pick('Passer', 'تخطي', lang) }],

  askQuestion: (lang: L) =>
    pick('Bien sûr.\nPouvez-vous nous préciser l’information que vous recherchez ?', 'بالطبع.\nهل يمكنكم توضيح المعلومة التي تبحثون عنها؟', lang),

  askReason: (lang: L) =>
    pick(
      'Bien sûr.\nPouvez-vous nous préciser la raison de votre demande afin que nous puissions vous orienter rapidement ?',
      'بالطبع.\nهل يمكنكم توضيح سبب طلبكم حتى نتمكن من توجيهكم بسرعة؟',
      lang,
    ),

  askCallbackTime: (lang: L) =>
    pick('Quand préférez-vous être rappelé(e) ?', 'متى تفضلون أن نتصل بكم؟', lang),

  callbackButtons: (lang: L) => [
    { id: 'time:ASAP', label: pick('Dès que possible', 'في أقرب وقت', lang) },
    { id: 'time:TODAY', label: pick('Aujourd’hui', 'اليوم', lang) },
    { id: 'time:TOMORROW', label: pick('Demain', 'غدًا', lang) },
  ],

  tooShort: (lang: L) =>
    pick('Pouvez-vous nous en dire un peu plus ? Quelques mots suffisent.', 'هل يمكنكم توضيح المزيد؟ بضع كلمات تكفي.', lang),

  useButtons: (lang: L) =>
    pick('Merci de choisir l’une des options ci-dessous 👇', 'المرجو اختيار أحد الخيارات أسفله 👇', lang),

  /** {{demandNumber}} is substituted by the application service once the demand exists. */
  completed: (lang: L, phone: string) =>
    pick(
      `✅ Votre demande n°{{demandNumber}} est enregistrée.\nUn professionnel vous contactera très rapidement au ${phone}.\nMerci d’avoir utilisé Telecontact !`,
      `✅ تم تسجيل طلبكم رقم {{demandNumber}}.\nسيتصل بكم مهني قريبًا على الرقم ${phone}.\nشكرًا لاستخدامكم تيليكونتاكت!`,
      lang,
    ),

  alreadyCompleted: (lang: L) =>
    pick(
      'Votre demande n°{{demandNumber}} est bien enregistrée et en cours de traitement. Pour une nouvelle demande, appuyez sur le bouton ci-dessous.',
      'طلبكم رقم {{demandNumber}} مسجل وقيد المعالجة. لطلب جديد اضغطوا على الزر أسفله.',
      lang,
    ),

  afterRefusal: (lang: L) =>
    pick(
      'Nous respectons votre choix 🙏 Si vous changez d’avis, appuyez sur « Recommencer ».',
      'نحترم اختياركم 🙏 إذا غيرتم رأيكم اضغطوا على «إعادة البدء».',
      lang,
    ),

  restartButton: (lang: L, kind: 'new' | 'restart') => [
    { id: 'restart', label: kind === 'new' ? pick('Nouvelle demande', 'طلب جديد', lang) : pick('Recommencer', 'إعادة البدء', lang) },
  ],

  welcomeBack: (lang: L) =>
    bi('Rebonjour 👋 Reprenons là où nous nous étions arrêtés.', 'مرحبًا من جديد 👋 لنكمل من حيث توقفنا.', lang),
};

export const CALLBACK_LABELS: Record<CallbackTime, string> = {
  ASAP: 'Dès que possible',
  TODAY: 'Aujourd’hui',
  TOMORROW: 'Demain',
};
