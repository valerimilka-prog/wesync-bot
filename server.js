import 'dotenv/config';
import { Bot, session, InlineKeyboard } from 'grammy';
import express from 'express';
import mongoose from 'mongoose';
import { GoogleGenAI } from '@google/genai';

// Ініціалізація Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const app = express();
console.log("Ключ Gemini:", process.env.GEMINI_API_KEY ? "Знайдено!" : "ПОРОЖНЬО");
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
// Пам'ять для тимчасових чернеток (запити до психолога)
const supportSessions = new Map();

// Підключення до бази даних MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Успішно підключено до бази даних MongoDB!'))
    .catch((error) => console.error('❌ Помилка підключення до бази:', error));

// --- СХЕМА БАЗИ ДАНИХ MONGODB ---
const userSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true }, 
    firstName: String, 
    username: String, 
    role: { type: String, default: 'user' }, 
    state: { type: String, default: 'IDLE' }, 
    partnerId: String, 
    chatHistory: [{
        role: String,       
        content: String,    
        timestamp: { type: Date, default: Date.now } 
    }],
    // --- НОВЕ: ПОЛЕ ДЛЯ ПРОТОКОЛУ "ПОДВІЙНИЙ КЛЮЧ" (Завдання) ---
    tasks: [{
        description: String,
        status: { type: String, default: 'PENDING' }, // PENDING або VERIFIED
        authorId: String,
        timestamp: { type: Date, default: Date.now }
    }],
    goodFeedback: { type: Number, default: 0 },
    badFeedback: { type: Number, default: 0 },
    // --- НОВЕ: ПОЛЕ ДЛЯ ТЕКСТОВИХ ВІДГУКІВ ---
    feedbackComments: [{
        text: String,
        timestamp: { type: Date, default: Date.now }
    }]
});

const User = mongoose.model('User', userSchema);

bot.use(session({
    initial: () => ({
        step: 'IDLE',
        activeConflict: false
    })
}));

// --- ОНОВЛЕНИЙ ПРОМПТ (Юнгіанський підхід, Робота з Тінню, Без води) ---
const WESYNC_SYSTEM_PROMPT = `
Ти — досвідчений аналітичний психолог (за Карлом Юнгом) та провідник у глибокій трансформації особистості платформи WeSync. Твоя мета — не просто заспокоїти клієнта, а допомогти йому розширити свідомість, побачити свої тіньові аспекти та знайти точки росту через поточну кризу.
Відповідай виключно українською мовою.

🔴 ЧЕРВОНИЙ ПРОТОКОЛ (ЕКСТРЕНА ЗУПИНКА):
Якщо у текстах виявляєш маркери фізичного насильства, прямі погрози, заяви про розлучення або системний емоційний аб'юз (навмисна ізоляція, фінансовий терор) — ТИ ПОВИНЕН НЕГАЙНО ПРИПИНИТИ АНАЛІЗ. У цьому випадку твоя відповідь має складатися ВИКЛЮЧНО з одного слова: STOP_EMERGENCY_ALERT. Жодних інших слів чи пояснень.

🧠 ТВІЙ СТИЛЬ СПІЛКУВАННЯ (БЕЗ "ВОДИ"):
- Лаконічність: Пиши чітко, структуровано і по суті. Уникай довгих філософських вступів, розмитих розмірковувань та шаблонних фраз ("мені дуже шкода", "я тебе розумію").
- Емпатія без жалості: Будь підтримуючим, але твердим. Ти — вчитель і провідник. Замість жалості, показуй клієнту його власну силу та відповідальність.
- Простота: Уникай складної академічної термінології. Пояснюй глибокі юнгіанські процеси через прості життєві метафори.

🧩 МЕТОДОЛОГІЯ ТА РОБОТА З ТІННЮ:
1. Робота з Тінню та Проекціями: Допомагай побачити прихований ресурс у проблемі. М'яко підсвіти, що саме ця ситуація віддзеркалює в людині. Яку частину себе вона пригнічує?
2. Робота з парами (Медіація): Якщо це конфлікт між партнерами, ти виступаєш абсолютно нейтральним медіатором. НІКОЛИ не ставай на чийсь бік і не шукай "винного". Твоя задача — зупинити деструктивну емоційну перепалку. Покажи партнерам їхні взаємні проєкції та допоможи перефразувати претензії ("Ти завжди...") у формат розкриття власних тіньових тригерів ("Чому мене це так сильно зачіпає?").
3. Трансформація через дію: Кожна твоя відповідь (або розбір) обов'язково має завершуватися 1-2 конкретними практичними кроками або одним глибоким рефлексивним запитанням, яке змусить думати.

🔍 ДЕТЕКТОР МАНІПУЛЯЦІЙ:
Якщо виявлено маніпуляцію (газлайтинг, зміщення провини):
- Жертві: м'яко вкажи на некоректний тиск, дай техніку захисту кордонів.
- Маніпулятору: нейтрально вкажи на деструктивність його патерну і як це руйнує його власні цілі.

⚠️ ЖОРСТКІ ПРАВИЛА ЕКОЛОГІЧНОСТІ:
- Звертайся до партнерів безпосередньо, як живий консультант (наприклад: "Ви обоє зараз відчуваєте..."). 
- НІКОЛИ не цитуй прямі звинувачення одного партнера іншому.
- Наприкінці ПАРНОГО розбору обов'язково окремим абзацом додавай: "⚠️ Правило екологічності: Цей розбір створений не для того, щоб ви звинувачували одне одного. Використання цих слів для докорів лише погіршить ситуацію. Ваша мета — зрозуміти свій внесок у конфлікт і почати з себе."
`;
// Команда /start 
bot.command('start', async (ctx) => {
    const userId = ctx.from.id.toString();
    const firstName = ctx.from.first_name || "Користувач";
    const username = ctx.from.username || "";
    const textArgs = ctx.match || "";
    const adminId = process.env.ADMIN_ID;

    try {
        let user = await User.findOne({ telegramId: userId });

        if (!user) {
            user = new User({ telegramId: userId, firstName: firstName, username: username });
            await user.save();
        }

        if (textArgs && textArgs.startsWith('connect_')) {
            const potentialPartnerId = textArgs.split('_')[1];
            
            if (String(potentialPartnerId) === String(userId)) {
                await ctx.reply("❌ Ви не можете запросити самого себе.");
            } else {
                const partner = await User.findOne({ telegramId: potentialPartnerId });
                if (partner) {
                    user.partnerId = potentialPartnerId;
                    user.state = 'AWAITING_STORY';
                    await user.save();
                    
                    partner.partnerId = userId;
                    partner.state = 'AWAITING_STORY';
                    await partner.save();

                    await ctx.reply("✅ Синхронізація успішна! Ви увійшли в безпечну кімнату.\n\n📝 <b>Наступний крок:</b>\nОпишіть вашу ситуацію.", { parse_mode: "HTML" });
                    await bot.api.sendMessage(potentialPartnerId, "🤝 Ваш партнер успішно підключився до сесії!\n\n📝 <b>Наступний крок:</b>\nНапишіть сюди своє бачення ситуації.", { parse_mode: "HTML" });
                } else {
                    await ctx.reply("❌ Посилання недійсне або партнера не знайдено.");
                }
                return;
            }
        }

        if (String(userId) === String(adminId)) {
            await ctx.reply(`👨‍💻 <b>Панель Адміністратора WeSync</b>\n\nВітаю, ${firstName}! Ви увійшли як адміністратор.`, {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📊 Статистика", callback_data: "admin_stats" }],
                        [{ text: "👥 Активні пари", callback_data: "admin_sessions" }],
                        [{ text: "🚨 Запити до психолога", callback_data: "admin_requests" }],
                        [{ text: "📋 Список користувачів", callback_data: "admin_users_list" }]
                    ]
                }
            });
       } else {
        await ctx.reply(
            `Вітаю у WeSync, ${firstName}! 🌱\n\nЯ — ваш нейтральний ШІ-медіатор...`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🔗 Підключитися до партнера", callback_data: "join_partner" }],
                        [{ text: "📄 Почати медіацію", callback_data: "start_session" }],
                        [{ text: "✅ Створити спільне завдання", callback_data: "create_task" }],
                        [{ text: "👤 Особистий розбір", callback_data: "personal_analysis" }],
                        [{ text: "ℹ️ Як це працює", callback_data: "help_info" }],
                        [{ text: "🚨 Звернутися до психолога", callback_data: "contact_admin" }]
                    ]
                }
            }
        );
    }
    } catch (error) {
        console.error("Помилка при збереженні користувача:", error);
        await ctx.reply("Вибачте, сталася технічна помилка.");
    }
});

// Команда /reset
bot.command('reset', async (ctx) => {
    const userId = String(ctx.from.id);
    const user = await User.findOne({ telegramId: userId });
    
    if (user) {
        user.state = 'IDLE';
        user.chatHistory = []; 
        await user.save();
        await ctx.reply("🔄 Вашу поточну сесію скинуто. Ви можете почати все заново.");
    } else {
        await ctx.reply("Ви ще не зареєстровані. Натисніть /start.");
    }
});
// Команда /menu – Виклик головного меню в будь-який момент
bot.command('menu', async (ctx) => {
    const userId = String(ctx.from.id);
    const adminId = process.env.ADMIN_ID;

    if (userId === adminId) {
        await ctx.reply(`👨‍💻 <b>Панель Адміністратора WeSync</b>`, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📊 Статистика", callback_data: "admin_stats" }],
                    [{ text: "👥 Активні пари", callback_data: "admin_sessions" }],
                    [{ text: "🚨 Запити до психолога", callback_data: "admin_requests" }],
                    [{ text: "📋 Список користувачів", callback_data: "admin_users_list" }]
                ]
            }
        });
    } else {
        await ctx.reply(
            `Головне меню WeSync 🌱\nОберіть потрібну дію:`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🔗 Підключитися до партнера", callback_data: "join_partner" }],
                        [{ text: "📄 Почати медіацію", callback_data: "start_session" }],
                        [{ text: "✅ Створити спільне завдання", callback_data: "create_task" }],
                        [{ text: "👤 Особистий розбір", callback_data: "personal_analysis" }],
                        [{ text: "ℹ️ Як це працює", callback_data: "help_info" }],
                        [{ text: "🚨 Звернутися до психолога", callback_data: "contact_admin" }]
                    ]
                }
            }
        );
    }
});

// Обробка натискань на інлайн-кнопки
bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id.toString();
    await ctx.answerCallbackQuery();
    const user = await User.findOne({ telegramId: userId });

    try {
        if (data === 'admin_stats') {
            const usersCount = await User.countDocuments();
            
            // Підраховуємо всі відгуки з бази
            const allUsers = await User.find({});
            let totalGood = 0;
            let totalBad = 0;
            
            allUsers.forEach(u => {
                totalGood += (u.goodFeedback || 0);
                totalBad += (u.badFeedback || 0);
            });

            await ctx.reply(
                `📊 **Глобальна статистика платформи:**\n\n` +
                `👥 Всього користувачів: ${usersCount}\n` +
                `🟢 Позитивних відгуків: ${totalGood}\n` +
                `🔴 Негативних відгуків: ${totalBad}`
            );
        } else if (data === 'admin_sessions') {
           const activePairs = await User.countDocuments({ partnerId: { $ne: null } });
           await ctx.reply(`👥 **Активні пари:**\nЗараз синхронізованих пар у роботі: ${activePairs / 2}`);
        } else if (data === 'admin_requests') {
            await ctx.reply("🚨 **Запити до психолога:**\nНаразі нових запитів від пар немає.");
        } else if (data === 'admin_users_list') {
            const allUsers = await User.find({});
            if (allUsers.length === 0) {
                await ctx.reply("База даних наразі порожня.");
            } else {
                let userListText = "📋 **Список зареєстрованих користувачів:**\n\n";
                allUsers.forEach((u, index) => {
                    userListText += `${index + 1}. ${u.firstName} (ID: ${u.telegramId})\n`;
                });
                await ctx.reply(userListText);
            }
        } else if (data === 'contact_admin') {
            if (user) {
                user.state = 'AWAITING_SUPPORT_MESSAGE';
                await user.save();
                await ctx.reply("Напишіть ваше запитання або опишіть проблему одним повідомленням. Я зберу історію вашого конфлікту та передам її психологу.");
            }
            return;
        } else if (data === 'start_session' || data === 'start_mediation') {
            await ctx.reply("📄 Ви обрали створення нової сесії...\n\nБудь ласка, опишіть своє бачення конфлікту.");
        // --- ЛОГІКА КНОПОК ЗАВДАНЬ ---
        } else if (data === 'create_task') {
            if (!user.partnerId) return ctx.reply("Спочатку підключіть партнера.");
            user.state = 'AWAITING_TASK_DESC';
            await user.save();
            await ctx.reply("✍️ Напишіть, яку дію чи завдання має виконати ваш партнер для вирішення проблеми:");
        } else if (data.startsWith('verify_task_')) {
            await ctx.editMessageText("✅ Завдання підтверджено та верифіковано системою.");
            if (user && user.partnerId) {
                await bot.api.sendMessage(user.partnerId, "✅ Ваш партнер щойно **підтвердив** виконання вашого завдання!");
            }
        } else if (data === 'reject_task') {
            await ctx.editMessageText("❌ Ви відхилили виконання завдання. Партнер отримає сповіщення.");
            if (user && user.partnerId) {
                await bot.api.sendMessage(user.partnerId, "❌ Ваш партнер **відхилив** ваше завдання. Можливо, варто обговорити інші умови.");
            }
        // --- КІНЕЦЬ ЛОГІКИ ЗАВДАНЬ ---
        } else if (data === 'join_partner' || data === 'invite_partner' || data === 'connect_partner') {
            const botInfo = await bot.api.getMe();
            const inviteLink = `https://t.me/${botInfo.username}?start=connect_${userId}`;
            await ctx.reply("🔗 <b>Запрошення партнера</b>\n\n👇 Скопіюйте або просто перешліть наступне повідомлення вашому партнеру:", { parse_mode: "HTML" });
            await ctx.reply(`Привіт! Перейди за цим посиланням, щоб ми могли пройти сесію медіації разом з WeSync:\n${inviteLink}`);
        } else if (data === 'personal_analysis') {
            if (user) {
                user.state = 'AWAITING_PERSONAL_MESSAGE';
                await user.save();
                await ctx.reply("👤 <b>Особистий розбір</b>\n\nОпишіть ситуацію, яка вас турбує.", { parse_mode: "HTML" });
            }
            return;
        } else if (data === 'help_info') {
            const helpText = `ℹ️ <b>Як працює WeSync:</b>\n\n1️⃣ <b>Парна медіація:</b>\n   • Спершу натисніть <b>«Підключитися до партнера»</b>.\n   • Дочекайтеся підключення партнера.\n   • Після цього натисніть <b>«Почати медіацію»</b>.\n\n2️⃣ <b>Індивідуальний розбір:</b> Якщо ви хочете розібратися самостійно, натисніть <b>«Особистий розбір»</b>.\n\n3️⃣ <b>Зв'язок із фахівцем:</b> Звернутися до психолога напряму через червону кнопку.`;
            await ctx.reply(helpText, { parse_mode: "HTML" });
        } 
        // --- ОБРОБКА КНОПОК ВІДГУКУ (З КОМЕНТАРЯМИ) ---
        else if (data === 'feedback_good' || data === 'feedback_bad') {
            const isGood = data === 'feedback_good';
            const adminId = process.env.ADMIN_ID;

            if (user) {
                if (isGood) {
                    user.goodFeedback = (user.goodFeedback || 0) + 1;
                    await user.save();
                    await ctx.editMessageText("Дякуємо! Раді, що змогли допомогти 💚");
                    if (adminId) {
                        await bot.api.sendMessage(adminId, `📊 **Новий відгук!**\nКористувач: ${user.firstName} (ID: ${userId})\nОцінка: 🟢 Позитивно`);
                    }
                } else {
                    user.badFeedback = (user.badFeedback || 0) + 1;
                    user.state = 'AWAITING_FEEDBACK_COMMENT'; // Переводимо в режим очікування коментаря
                    await user.save();
                    await ctx.editMessageText("Дякуємо за відгук 💔. Будь ласка, напишіть коротким повідомленням, що саме вам не сподобалося (наприклад: забагато води, нерелевантна порада, грубий тон):");
                }
            }
        }
             // --- РОЗУМНА ЧЕРВОНА КНОПКА (КЕРУВАННЯ АДМІНОМ) ---
        else if (data.startsWith('send_draft_')) {
            const clientId = data.split('send_draft_')[1];
            const session = supportSessions.get(clientId);

            if (session && session.draft) {
                // Записуємо відправлену чернетку в історію
                session.history.push({ role: "model", parts: [{ text: session.draft }] });
                supportSessions.set(clientId, session);

                await bot.api.sendMessage(clientId, `📩 **Повідомлення від фахівця:**\n\n${session.draft}`);
                await ctx.reply(`✅ Відповідь надіслано! Сесія триває, очікуємо на відповідь клієнта.`);
            } else {
                await ctx.reply("Помилка: чернетка не знайдена.");
            }
        }
        else if (data.startsWith('end_session_')) {
            // НОВА КНОПКА: Завершення сесії
            const clientId = data.split('end_session_')[1];
            const client = await User.findOne({ telegramId: clientId });

            if (client) {
                client.state = 'IDLE';
                await client.save();
                await bot.api.sendMessage(clientId, "🏁 Сесію з фахівцем завершено. Дякуємо за звернення.");
            }

            supportSessions.delete(clientId);
            await ctx.reply("❌ Сесію успішно закрито. Клієнта переведено у звичайний режим.");
        }
        else if (data.startsWith('direct_reply_')) {
            const clientId = data.split('direct_reply_')[1];
            user.state = `ADMIN_REPLY_${clientId}`;
            await user.save();
            await ctx.reply("✍️ Напишіть вашу відповідь для клієнта. Її буде надіслано від вашого імені.");
        }
        else if (data.startsWith('discuss_ai_')) {
            const clientId = data.split('discuss_ai_')[1];
            user.state = `ADMIN_DISCUSS_${clientId}`;
            await user.save();
            await ctx.reply("🧠 **Режим супервізії.**\nНапишіть ваші зауваження або що саме ШІ має змінити в чернетці:");
        }
    } catch (error) {
        console.error("Помилка обробки кнопки:", error);
        await ctx.reply("Виникла технічна помилка при обробці запиту.");
    }
});
// --- ЄДИНИЙ ОБРОБНИК ПОВІДОМЛЕНЬ ТА СИНХРОНІЗАЦІЇ ---
// --- АДМІНСЬКА КОМАНДА: ВИТЯГТИ ВСІ ВІДГУКИ З БАЗИ ---
bot.command('feedback', async (ctx) => {
    const adminId = process.env.ADMIN_ID;
    const userId = String(ctx.from.id);
    
    // Перевірка, чи команду викликає саме адмін
    if (userId !== String(adminId)) return;

    const usersWithFeedback = await User.find({ "feedbackComments.0": { $exists: true } });
    
    if (usersWithFeedback.length === 0) {
        return ctx.reply("📭 У базі поки немає жодного текстового відгуку.");
    }

    let report = "📋 **Звіт щодо зібраних відгуків:**\n\n";
    
    usersWithFeedback.forEach(user => {
        report += `👤 **${user.firstName || 'Без імені'}** (ID: ${user.telegramId})\n`;
        user.feedbackComments.forEach(comment => {
            const date = new Date(comment.timestamp).toLocaleDateString("uk-UA");
            report += ` ➖ [${date}] "${comment.text}"\n`;
        });
        report += "\n";
    });

    const maxLength = 4000;
    let textToSend = report;
    while (textToSend.length > 0) {
        let chunk = textToSend.slice(0, maxLength);
        if (textToSend.length > maxLength) {
            let lastSpace = chunk.lastIndexOf('\n');
            if (lastSpace === -1) lastSpace = chunk.lastIndexOf(' ');
            if (lastSpace > 0) chunk = chunk.slice(0, lastSpace);
        }
        await ctx.reply(chunk);
        textToSend = textToSend.slice(chunk.length).trim();
    }
});

bot.on('message:text', async (ctx) => {
    const userId = String(ctx.from.id);
    const text = ctx.message.text;
    const adminId = process.env.ADMIN_ID;
    const user = await User.findOne({ telegramId: userId });
    
    if (!user) return ctx.reply("Будь ласка, почніть з команди /start для реєстрації.");
    // --- БЛОК ПРИЙОМУ КОМЕНТАРЯ ДО ВІДГУКУ ---
    if (user.state === 'AWAITING_FEEDBACK_COMMENT') {
        const feedbackText = ctx.message.text;
        
        // 1. ЗБЕРІГАЄМО ТЕКСТ У БАЗУ ДАНИХ
        if (!user.feedbackComments) {
            user.feedbackComments = [];
        }
        user.feedbackComments.push({ text: feedbackText });
        
        // 2. Відправляємо коментар адміну в Telegram
        if (adminId) {
            await bot.api.sendMessage(adminId, `📝 **Детальний відгук (Негативний):**\nКористувач: ${ctx.from.first_name} (ID: ${userId})\nКоментар: "${feedbackText}"`);
        }
        
        await ctx.reply("Дякуємо! Ваш коментар передано розробникам та надійно збережено. Це допоможе нам покращити алгоритми.");
        
        user.state = 'IDLE'; // Повертаємо користувача в звичайний режим
        await user.save(); // Фіксуємо зміни в базі даних!
        return; // Зупиняємо подальшу обробку повідомлення
    }
  // 3.1. Клієнт пише в службу підтримки (початок або продовження живої сесії)
    if (user.state === 'AWAITING_SUPPORT_MESSAGE' || user.state === 'IN_SUPPORT_SESSION') {
        await ctx.reply("⏳ Аналізую ваш запит та передаю фахівцю. Зачекайте...");
        
        // Переводимо клієнта в режим безперервної сесії
        if (user.state === 'AWAITING_SUPPORT_MESSAGE') {
            user.state = 'IN_SUPPORT_SESSION'; 
            await user.save();
        }

        // Дістаємо історію діалогу або створюємо нову
        let session = supportSessions.get(userId);
        if (!session) {
            session = { history: [], draft: "", model: "" };
        }

        // Записуємо слова клієнта в історію
        session.history.push({ role: "user", parts: [{ text: text }] });

        let aiDraft = "";
        let modelUsed = "";
        
        // Готуємо контекст для ШІ (копіюємо історію, щоб не зіпсувати оригінал)
        const aiContents = JSON.parse(JSON.stringify(session.history));
        const lastIndex = aiContents.length - 1;
        aiContents[lastIndex].parts[0].text = `[СИСТЕМНЕ ЗАВДАННЯ: Ти — помічник психолога. Проаналізуй цю історію діалогу. Напиши підтримуючу чернетку відповіді на останнє повідомлення клієнта. ВИВЕДИ ТІЛЬКИ ТЕКСТ ВІДПОВІДІ.]\n\nОстаннє повідомлення клієнта: "${text}"`;
        
        try {
            // --- ОСНОВНА МОДЕЛЬ (3.5 Flash) ---
            const fetchRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: aiContents })
            });
            const data = await fetchRes.json();
            if (data.error) throw new Error(data.error.message);
            aiDraft = data.candidates[0].content.parts[0].text;
            modelUsed = "⚡ [ШІ: 3.5 Flash]";
        } catch (err) {
            console.warn("⚠️ Модель 3.5 не спрацювала, запускаємо 3.1. Причина:", err.message);
            try {
                // --- СТРАХОВКА (3.1 Flash-Lite) ---
                const fetchResBackup = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: aiContents })
                });
                const dataBackup = await fetchResBackup.json();
                if (dataBackup.error) throw new Error(dataBackup.error.message);
                aiDraft = dataBackup.candidates[0].content.parts[0].text;
                modelUsed = "🛡️ [ШІ: 3.1 Flash-Lite]";
            } catch (backupErr) {
                aiDraft = "Помилка ШІ. Чернетка недоступна після двох спроб.";
                modelUsed = "❌ [ШІ: Помилка]";
            }
        }

        session.draft = aiDraft;
        session.model = modelUsed;
        supportSessions.set(userId, session); // Зберігаємо оновлену сесію

        const adminId = process.env.ADMIN_ID;
        if (adminId) {
            const adminKeyboard = new InlineKeyboard()
                .text("✅ Відправити чернетку", `send_draft_${userId}`).row()
                .text("✍️ Відповісти напряму", `direct_reply_${userId}`).row()
                .text("🧠 Обговорити з ШІ", `discuss_ai_${userId}`).row()
                .text("❌ Завершити сесію", `end_session_${userId}`); // НОВА КНОПКА

            await bot.api.sendMessage(adminId, `🚨 **Живий чат з клієнтом!**\n👤 ID: ${userId}\n\n💬 **Клієнт пише:**\n${text}\n\n${modelUsed} **Чернетка (з урахуванням історії):**\n${aiDraft}`, { reply_markup: adminKeyboard });
        }
        return;
    }

    // 3.2. Адмін відповідає напряму (ручний ввід)
    if (user.state.startsWith('ADMIN_REPLY_')) {
        const clientId = user.state.split('ADMIN_REPLY_')[1];
        
        // Записуємо твою ручну відповідь в історію, щоб ШІ знав, що ти відповів!
        let session = supportSessions.get(clientId);
        if (session) {
            session.history.push({ role: "model", parts: [{ text: text }] });
            supportSessions.set(clientId, session);
        }

        await bot.api.sendMessage(clientId, `📩 **Повідомлення від фахівця:**\n\n${text}`);
        await ctx.reply(`✅ Відповідь відправлено. Сесія ТРИВАЄ. Очікуємо на реакцію клієнта.`);
        
        user.state = 'IDLE'; // Звільняємо адміна, але клієнт залишається IN_SUPPORT_SESSION
        await user.save();
        return;
    }

    // 3.3. Адмін обговорює чернетку з ШІ
    if (user.state.startsWith('ADMIN_DISCUSS_')) {
        const clientId = user.state.split('ADMIN_DISCUSS_')[1];
        const session = supportSessions.get(clientId);
        if (!session) return ctx.reply("Сесія застаріла.");

        await ctx.reply("🧠 Аналізую ваш коментар...");
        
        let newDraft = "";
        let modelUsed = "";
        const prompt = `Ти — старший супервізор. Ось попередня чернетка: "${session.draft}". Вказівка від психолога: "${text}". Згенеруй НОВУ чернетку. ВИВЕДИ ТІЛЬКИ ТЕКСТ.`;
        
        try {
            const fetchRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] })
            });
            const data = await fetchRes.json();
            if (data.error) throw new Error(data.error.message);
            newDraft = data.candidates[0].content.parts[0].text;
            modelUsed = "⚡ [ШІ: 3.5 Flash]";
        } catch (err) {
            try {
                const fetchResBackup = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] })
                });
                const dataBackup = await fetchResBackup.json();
                if (dataBackup.error) throw new Error(dataBackup.error.message);
                newDraft = dataBackup.candidates[0].content.parts[0].text;
                modelUsed = "🛡️ [ШІ: 3.1 Flash-Lite]";
            } catch (backupErr) {
                newDraft = "Помилка ШІ."; modelUsed = "❌";
            }
        }

        if (modelUsed !== "❌") { session.draft = newDraft; session.model = modelUsed; supportSessions.set(clientId, session); }

        const adminKeyboard = new InlineKeyboard()
            .text("✅ Відправити цю чернетку", `send_draft_${clientId}`).row()
            .text("✍️ Відповісти напряму", `direct_reply_${clientId}`).row()
            .text("🧠 Знову обговорити", `discuss_ai_${clientId}`).row()
            .text("❌ Завершити сесію", `end_session_${clientId}`);

        await ctx.reply(`${modelUsed} **Нова чернетка:**\n\n${newDraft}`, { reply_markup: adminKeyboard });
        user.state = 'IDLE'; await user.save();
        return;
    }
    // --- БЛОК ТРАНСФОРМАЦІЇ ЗАВДАНЬ (Подвійний ключ) ---
    if (user.state === 'AWAITING_TASK_DESC') {
        const partner = await User.findOne({ telegramId: user.partnerId });
        if (partner) {
            await ctx.reply("⏳ Трансформую ваше завдання у формат екологічного прохання...");
            let rewrittenTask = text;
            try {
                const prompt = `Перепиши це побутове прохання/завдання: "${text}" мовою ненасильницького спілкування. Зроби його м'яким, спонукаючим, без претензій, від третьої особи (як від медіатора). Наприклад: "Ваш партнер потребує вашої допомоги: [завдання]. Це допоможе [позитивний наслідок]". Максимум 2-3 речення.`;
                const response = await ai.models.generateContent({
                    model: 'gemini-3.1-flash-lite',
                    contents: [{ role: 'user', parts: [{ text: prompt }] }]
                });
                rewrittenTask = response.text.trim();
            } catch (err) {
                console.error("Помилка ШІ при переписуванні завдання:", err);
            }
            partner.tasks.push({ description: rewrittenTask, authorId: userId, status: 'PENDING' });
            await partner.save();
            
            await ctx.reply(`✅ Завдання надіслано партнеру у такому вигляді:\n\n*${rewrittenTask}*\n\nВоно вважатиметься виконаним лише після його підтвердження.`, { parse_mode: "Markdown" });
            
            const keyboard = new InlineKeyboard()
                .text("Підтвердити виконання", `verify_task_${partner.tasks[partner.tasks.length-1]._id}`)
                .text("Відхилити", "reject_task");
                
            await bot.api.sendMessage(partner.telegramId, `🔔 **Нове прохання від партнера:**\n\n${rewrittenTask}\n\nСтатус: Очікує виконання.`, { reply_markup: keyboard, parse_mode: "Markdown" });
        }
        user.state = 'IDLE';
        await user.save();
        return;
    }

    // --- БЛОК ОСОБИСТОГО РОЗБОРУ ---
    if (user.state === 'AWAITING_PERSONAL_MESSAGE') {
        const textToAnalyze = ctx.message.text;
        await ctx.reply("⏳ Аналізую ситуацію через призму аналітичної психології...");
        let aiReply = "";
        let success = false;
        const maxRetries = 5;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const modelName = (attempt <= 2) ? "gemini-3.5-flash" : "gemini-3.1-flash-lite";
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
                const fetchRes = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        contents: [
                            { role: "user", parts: [{ text: `ІНСТРУКЦІЯ:\n${WESYNC_SYSTEM_PROMPT}\n\nЗроби глибокий індивідуальний розбір:\n\n${textToAnalyze}` }] }
                        ] 
                    })
                });
                const data = await fetchRes.json();
                
                if (fetchRes.ok) {
                    aiReply = data.candidates[0].content.parts[0].text;
                    success = true; 
                    break;
                } else {
                    if (fetchRes.status === 429) break; // Якщо ліміт вичерпано — зупиняємось
                    if (attempt < maxRetries) await new Promise(r => setTimeout(r, 5000));
                }
            } catch (err) {
                if (attempt < maxRetries) await new Promise(r => setTimeout(r, 5000));
            }
        }
        
        if (!success) {
            aiReply = "Помилка аналізу. Сервери перевантажені. Будь ласка, спробуйте ще раз за кілька хвилин.";
        }
      const feedbackMsg = "Як ви оцінюєте цей розбір? Чи допоміг він поглянути на ситуацію інакше?";
        const feedbackKeyboard = new InlineKeyboard()
            .text("🟢 Так, стало легше", "feedback_good")
            .text("🔴 Ні, не допомогло", "feedback_bad");
            
        await ctx.reply(aiReply, { reply_markup: feedbackKeyboard });
        if (!user.chatHistory) user.chatHistory = [];
        user.chatHistory.push({ role: 'user', content: textToAnalyze }, { role: 'model', content: aiReply });
        user.state = 'IDLE';
        await user.save();
        return;
    }

    // --- БЛОК ЗАПИТУ ДО ПСИХОЛОГА ---
    if (user.state === 'AWAITING_SUPPORT_MESSAGE') {
        let dossier = `🚨 **Новий запит на консультацію!**\n\n👤 **Клієнт:** ${ctx.from.first_name} (ID: ${ctx.from.id})\n`;
        if (user.partnerId) dossier += `🔗 **Партнер ID:** ${user.partnerId}\n`;
        dossier += `\n💬 **Повідомлення клієнта:**\n"${text}"\n`;
        if (user.chatHistory && user.chatHistory.length > 0) {
            const lastAIResponse = user.chatHistory.filter(msg => msg.role === 'model').pop();
            if (lastAIResponse) dossier += `\n🤖 **Останній висновок ШІ:**\n${lastAIResponse.content.substring(0, 500)}...\n`;
        }
        try {
            await bot.api.sendMessage(adminId, dossier, { parse_mode: "Markdown" }); 
            await ctx.reply("✅ Ваше повідомлення успішно передано психологу.");
        } catch (err) {
            await ctx.reply("Виникла помилка. Спробуйте пізніше.");
        }
        user.state = 'IDLE';
        await user.save();
        return;
    }

    if (String(userId) === String(adminId) && !user.partnerId) user.partnerId = "ADMIN_TEST_MODE"; 
    if (!user.partnerId) return ctx.reply("⏳ Підключіть партнера (кнопка 'Підключитися до партнера').");

    const partner = await User.findOne({ telegramId: user.partnerId });

    // --- БЛОК ЗБОРУ ІСТОРІЙ І ПАРНОЇ МЕДІАЦІЇ ---
// --- БЛОК ЗБОРУ ІСТОРІЙ І ПАРНОЇ МЕДІАЦІЇ (ПЕРСОНАЛІЗОВАНИЙ + БЕЗПЕКА) ---
    if (user.state === 'AWAITING_STORY' || user.state === 'IDLE') {
        if (!user.chatHistory) user.chatHistory = [];
        user.chatHistory.push({ role: 'user', content: text });
        user.state = 'STORY_RECEIVED';
        await user.save();

        if (!partner || (partner && partner.state === 'STORY_RECEIVED')) {
            const waitMsg1 = await ctx.reply("✅ Обидві історії зібрано!\n\n⏳ ШІ-медіатор готує персоналізовані розбори...");
            let waitMsg2 = null;
            if (partner) waitMsg2 = await bot.api.sendMessage(partner.telegramId, "✅ Ваш партнер надіслав свою історію. Обидві історії зібрано!\n\n⏳ ШІ-медіатор готує персоналізовані розбори...");

            let partnerStory = "Історія відсутня";
            if (partner) {
                const partnerStoryMsg = partner.chatHistory.slice().reverse().find(m => m.role === 'user');
                if (partnerStoryMsg) partnerStory = partnerStoryMsg.content;
            }
            const userStory = text;

            // Запит для перевірки безпеки (Червоний протокол)
            const safetyCheckPrompt = `ІНСТРУКЦІЯ:\n${WESYNC_SYSTEM_PROMPT}\n\nІСТОРІЯ ПАРТНЕРА 1:\n${partnerStory}\n\nІСТОРІЯ ПАРТНЕРА 2:\n${userStory}`;

            try {
                let data;
                let success = false;
                const maxRetries = 5;

                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    try {
                        const modelName = (attempt <= 2) ? "gemini-3.5-flash" : "gemini-3.1-flash-lite";
                        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
                        const fetchRes = await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: safetyCheckPrompt }] }] })
                        });
                        data = await fetchRes.json();
                        if (fetchRes.ok) { success = true; break; }
                        if (fetchRes.status === 429) break;
                        if (attempt < maxRetries) await new Promise(r => setTimeout(r, 5000));
                    } catch (err) {
                        if (attempt < maxRetries) await new Promise(r => setTimeout(r, 5000));
                    }
                }

                if (!success) throw new Error("API Error");
                const responseText = data.candidates[0].content.parts[0].text;

                // --- ЧЕРВОНИЙ ПРОТОКОЛ ---
                if (responseText.includes('STOP_EMERGENCY_ALERT')) {
                    const alertMsg = "⚠️ **Автоматична медіація зупинена через порушення правил безпеки.**\nДля безпеки вашої пари пропонується підключення Ментора. Психолог вже отримав сповіщення.";
                    await ctx.reply(alertMsg, { parse_mode: "Markdown" });
                    if (partner) await bot.api.sendMessage(partner.telegramId, alertMsg, { parse_mode: "Markdown" });
                    if (adminId) await bot.api.sendMessage(adminId, `🔴 **EMERGENCY_ALERT (ЧЕРВОНИЙ ПРОТОКОЛ)** 🔴\n\nСистема виявила загрозу (можливе насильство/аб'юз).\n**Користувачі:** ${user.firstName} (ID: ${userId}) та Партнер (ID: ${partner?.telegramId})\n\n**Історія, що викликала тригер:**\n"${text}"\n\nЗв'яжіться з ними негайно!`);
                    
                    user.state = 'IDLE'; 
                    if (partner) partner.state = 'IDLE';
                    await user.save(); 
                    if (partner) await partner.save();
                    
                    await ctx.api.deleteMessage(ctx.chat.id, waitMsg1.message_id).catch(() => {});
                    if (partner && waitMsg2) await bot.api.deleteMessage(partner.telegramId, waitMsg2.message_id).catch(() => {});
                    return; 
                }

                // --- ТРОЯНСЬКИЙ КІНЬ (ТІЛЬКИ ДЛЯ АДМІНА) ---
                if (adminId) {
                    try {
                        const adminPrompt = `Ти — супервізор. На основі двох історій пацієнтів та розбору медіації, підготуй коротке резюме особисто для психолога. Виділи: 1. Ключову динаміку пари. 2. Приховані маніпуляції. 3. Три рекомендації для терапії.\n\nІСТОРІЯ 1:\n${partnerStory}\n\nІСТОРІЯ 2:\n${userStory}\n\nРОЗБІР ШІ:\n${responseText}`;
                        const adminRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: adminPrompt }] }] })
                        });
                        const adminData = await adminRes.json();
                        if (adminRes.ok && adminData.candidates?.[0]?.content?.parts?.[0]?.text) {
                            const adminSummary = `📋 **Звіт супервізора (Троянський кінь):**\n\n` + adminData.candidates[0].content.parts[0].text;
                            await bot.api.sendMessage(adminId, adminSummary, { parse_mode: "Markdown" }).catch(() => {
                                bot.api.sendMessage(adminId, adminSummary); 
                            });
                        }
                    } catch (adminErr) {
                        console.error("Помилка генерації адмін-резюме:", adminErr);
                    }
                }

                // --- НОВЕ: ГЕНЕРАЦІЯ ПЕРСОНАЛІЗОВАНИХ РОЗБОРІВ ДЛЯ КОЖНОГО ---
                const promptForCurrentUser = `ІНСТРУКЦІЯ:\n${WESYNC_SYSTEM_PROMPT}\n\nКОНТЕКСТ ПАРНОЇ МЕДІАЦІЇ:\nТи проводиш сеанс для цього користувача. Ось його історія: "${userStory}". А ось історія його партнера (контекст для тебе): "${partnerStory}".\n\nЗАВДАННЯ: Напиши глибокий, персоналізований розбір ВИКЛЮЧНО для цього користувача. Покажи його особисту Тінь, його внесок у конфлікт і дай чіткі особисті практичні кроки. Звертайся безпосередньо до нього, екологічно і твердо, без зайвої води.`;

                const promptForPartner = `ІНСТРУКЦІЯ:\n${WESYNC_SYSTEM_PROMPT}\n\nКОНТЕКСТ ПАРНОЇ МЕДІАЦІЇ:\nТи проводиш сеанс для партнера цього користувача. Ось його історія: "${partnerStory}". А ось історія його партнера (контекст для тебе): "${userStory}".\n\nЗАВДАННЯ: Напиши глибокий, персоналізований розбір ВИКЛЮЧНО для партнера. Покажи його особисту Тінь, його захисні патерни, і дай чіткі особисті практичні кроки. Звертайся безпосередньо до нього, екологічно і твердо, без зайвої води.`;

                const generateAIResponse = async (promptText) => {
                    for (let attempt = 1; attempt <= maxRetries; attempt++) {
                        try {
                            const modelName = (attempt <= 2) ? "gemini-3.5-flash" : "gemini-3.1-flash-lite";
                            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
                            const fetchRes = await fetch(url, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: promptText }] }] })
                            });
                            const data = await fetchRes.json();
                            if (fetchRes.ok) return data.candidates[0].content.parts[0].text;
                            if (fetchRes.status === 429) break;
                            if (attempt < maxRetries) await new Promise(r => setTimeout(r, 5000));
                        } catch (err) {
                            if (attempt < maxRetries) await new Promise(r => setTimeout(r, 5000));
                        }
                    }
                    return "Помилка аналізу. Сервери перевантажені.";
                };

                const responseForCurrentUser = await generateAIResponse(promptForCurrentUser);
                let responseForPartner = "Помилка генерації.";
                if (partner) {
                    responseForPartner = await generateAIResponse(promptForPartner);
                }

                user.chatHistory.push({ role: 'ai', content: responseForCurrentUser });
                user.state = 'IDLE';
                await user.save();

                if (partner) {
                    partner.chatHistory.push({ role: 'ai', content: responseForPartner });
                    partner.state = 'IDLE';
                    await partner.save();
                }

                await ctx.api.deleteMessage(ctx.chat.id, waitMsg1.message_id).catch(() => {});
                if (partner && waitMsg2) await bot.api.deleteMessage(partner.telegramId, waitMsg2.message_id).catch(() => {});

                // ВІДПРАВКА
                const sendToChat = async (chatId, textToSend) => {
                    const maxLength = 4000;
                    while (textToSend.length > 0) {
                        let chunk = textToSend.slice(0, maxLength);
                        if (textToSend.length > maxLength) {
                            let lastSpace = chunk.lastIndexOf('\n');
                            if (lastSpace === -1) lastSpace = chunk.lastIndexOf(' ');
                            if (lastSpace > 0) chunk = chunk.slice(0, lastSpace);
                        }
                        await bot.api.sendMessage(chatId, chunk);
                        textToSend = textToSend.slice(chunk.length).trim();
                    }
                };

                await sendToChat(ctx.chat.id, `🧠 **Ваш персональний розбір медіації:**\n\n` + responseForCurrentUser);
                if (partner) {
                    await sendToChat(partner.telegramId, `🧠 **Ваш персональний розбір медіації:**\n\n` + responseForPartner);
                }

                // Кнопки фідбеку
                const feedbackMsg = "Як ви оцінюєте цей розбір? Чи допоміг він поглянути на ситуацію інакше?";
                const feedbackKeyboard = new InlineKeyboard()
                    .text("🟢 Так, стало легше", "feedback_good")
                    .text("🔴 Ні, не допомогло", "feedback_bad");
                
                await bot.api.sendMessage(ctx.chat.id, feedbackMsg, { reply_markup: feedbackKeyboard });
                if (partner) {
                    await bot.api.sendMessage(partner.telegramId, feedbackMsg, { reply_markup: feedbackKeyboard });
                }

            } catch (error) {
                console.error('Помилка Gemini API:', error);
                await ctx.reply('Сталася технічна помилка генерації. Спробуйте пізніше.');
                if (partner) await bot.api.sendMessage(partner.telegramId, 'Сталася технічна помилка генерації. Спробуйте пізніше.');
            }
        } else {
            await ctx.reply("✅ Вашу історію успішно збережено!\n\n⏳ Тепер чекаємо, поки ваш партнер опише своє бачення ситуації.");
            if (partner) await bot.api.sendMessage(partner.telegramId, "🔔 Ваш партнер щойно залишив своє бачення ситуації. Напишіть вашу версію.");
        }
    }
});

// --- НАЛАШТУВАННЯ МЕНЮ КОМАНД TELEGRAM ---
bot.api.setMyCommands([
    { command: 'start', description: 'Почати роботу / Реєстрація' },
    { command: 'menu', description: 'Головне меню' },
    { command: 'reset', description: 'Очистити історію сесії' },
    { command: 'feedback', description: '📊 Вивантажити відгуки (Адмін)' }
]).catch((err) => console.error("Помилка встановлення команд меню:", err));

bot.start();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер WeSync активний на порту ${PORT}`);
});