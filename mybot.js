import { Telegraf, Markup } from 'telegraf';
import { Scenes, session } from 'telegraf';
import dotenv from 'dotenv';
import db from './src/db.js';
import kieApi from './src/kie.js';
import logger from './src/logger.js';
import { runDoctor } from './scripts/doctor.mjs';
import { syncModels } from './scripts/kie-sync.mjs';

// Load environment variables
dotenv.config();

// Validate required environment variables
const REQUIRED_ENV = ['BOT_TOKEN', 'KIE_API_KEY', 'ADMIN_IDS', 'PAYMENT_REQUISITES_TEXT'];
const missingEnv = REQUIRED_ENV.filter(env => !process.env[env]);

if (missingEnv.length > 0) {
  console.error('[BOT] Missing required environment variables:', missingEnv);
  console.error('[BOT] Please check your .env file and .env.example for required variables');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// Check if user is admin
function isAdmin(userId) {
  if (!process.env.ADMIN_IDS) return false;
  const adminIds = process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim()));
  return adminIds.includes(userId);
}

// Format price for display
function formatPrice(rubles) {
  return rubles.toFixed(2) + ' ₽';
}

// Calculate price in rubles
function calculatePrice(credits) {
  const markup = parseFloat(process.env.MARKUP) || 2.0;
  const usdToRub = parseFloat(process.env.USD_TO_RUB) || 77.46;
  const currencyMode = process.env.CURRENCY_MODE || 'manual';
  
  if (credits) {
    // Convert credits to USD (assuming 1 credit = $0.01), then to RUB, then apply markup
    const usdValue = credits * 0.01;
    const rubValue = usdValue * usdToRub;
    const finalPrice = rubValue * markup;
    return Math.round(finalPrice * 100) / 100; // Return in rubles with 2 decimal places
  }
  
  // Default price if credits not known
  return Math.round(100 * markup * usdToRub) / 100; // in rubles
}

// Main menu keyboard - Russian UX
function mainMenuKeyboard() {
  return Markup.keyboard([
    ['🎨 Модели'],
    ['💰 Баланс/Оплата'],
    ['🧾 Мои задачи'],
    ['👤 Профиль'],
    ['🆘 Помощь']
  ]).resize();
}

// Models menu keyboard
function modelsMenuKeyboard() {
  return Markup.keyboard([
    ['🖼️ Фото', '🎬 Видео'],
    ['🎵 Аудио', '🧩 Другое'],
    ['🔍 Поиск'],
    ['⬅️ Назад']
  ]).resize();
}

// Format model info
function formatModelInfo(model) {
  let text = `📝 *${model.name}*\n\n`;
  text += `*Категория:* ${model.category}\n`;
  text += `*Группа:* ${model.group}\n`;
  
  if (model.pricing && model.pricing.credits) {
    const price = calculatePrice(model.pricing.credits);
    text += `*Цена:* ${formatPrice(price)}\n`;
  } else {
    text += `*Цена:* Уточняйте перед использованием\n`;
  }
  
  if (model.description) {
    text += `*Описание:* ${model.description.substring(0, 200)}${model.description.length > 200 ? '...' : ''}\n`;
  }
  
  if (model.input_schema && model.input_schema.properties) {
    const requiredFields = Object.keys(model.input_schema.properties);
    if (requiredFields.length > 0) {
      text += `*Требуемые параметры:* ${requiredFields.join(', ')}\n`;
    }
  }
  
  return text;
}

// Error handling middleware
bot.use(async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    console.error(`[BOT] Error processing update for user ${ctx.from?.id}:`, error);
    
    // Generate error code
    const errorCode = 'ERR_' + Date.now();
    
    // Send user-friendly message
    try {
      await ctx.reply(`❌ Произошла внутренняя ошибка (${errorCode}). Уже чиню...`);
    } catch (replyError) {
      console.error(`[BOT] Failed to send error message to user:`, replyError);
    }
  }
});

// On bot start
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  let user = await db.getUser(userId);

  if (!user) {
    user = {
      id: userId,
      username: ctx.from.username || null,
      first_name: ctx.from.first_name || null,
      balance: 0, // in rubles
      created_at: new Date().toISOString(),
      is_banned: false
    };
    await db.saveUser(user);
  } else {
    // Update user info
    await db.updateUser(userId, {
      username: ctx.from.username,
      first_name: ctx.from.first_name
    });
  }

  const balance = formatPrice(user.balance);

  ctx.replyWithMarkdown(
    `💰 *Ваш баланс:* ${balance}\n\n` +
    `Добро пожаловать в *AI Models Marketplace*!\n\n` +
    `Выберите действие:`,
    mainMenuKeyboard()
  );
});

// Help command
bot.help((ctx) => {
  ctx.replyWithMarkdown(
    `*Доступные команды:*\n\n` +
    `🎨 Модели - выбор нейросети для генерации\n` +
    `💰 Баланс/Оплата - информация о балансе и пополнение\n` +
    `🧾 Мои задачи - история ваших генераций\n` +
    `👤 Профиль - информация о вашем аккаунте\n` +
    `🆘 Помощь - это сообщение\n\n` +
    `Для администраторов: /admin`
  );
});

// Admin command
bot.command('admin', (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    ctx.reply('❌ У вас нет прав администратора.');
    return;
  }

  ctx.replyWithMarkdown(
    `*Панель администратора*\n\n` +
    `/admin - главное меню администратора\n` +
    `/syncmodels - синхронизировать модели\n` +
    `/setrate <rate> - установить курс USD/RUB\n` +
    `/setmarkup <markup> - установить наценку\n` +
    `/addbalance <userId> <amount> - пополнить баланс\n` +
    `/ban <userId> - заблокировать пользователя\n` +
    `/unban <userId> - разблокировать пользователя\n` +
    `/stats - статистика использования`
  );
});

// Main menu handlers
bot.hears('🎨 Модели', async (ctx) => {
  const models = await db.getModels();
  if (models.length === 0) {
    ctx.reply('❌ Каталог моделей пуст. Админ обновляет...');
    return;
  }

  ctx.replyWithMarkdown(
    `*Категории моделей:*\n\nВыберите категорию:`,
    modelsMenuKeyboard()
  );
});

bot.hears(['🖼️ Фото', '🎬 Видео', '🎵 Аудио', '🧩 Другое'], async (ctx) => {
  const emojiMap = {
    '🖼️ Фото': 'Фото',
    '🎬 Видео': 'Видео',
    '🎵 Аудио': 'Аудио',
    '🧩 Другое': 'Другое'
  };

  const selectedCategory = emojiMap[ctx.message.text];
  const models = await db.getModels();
  const categoryModels = models.filter(m => m.category === selectedCategory && m.enabled);

  if (categoryModels.length === 0) {
    ctx.reply(`❌ В категории "${selectedCategory}" пока нет доступных моделей.`);
    return;
  }

  let response = `*${selectedCategory} модели:*\n\n`;
  categoryModels.forEach((model, index) => {
    response += `${index + 1}. ${model.name}\n`;
    if (model.pricing && model.pricing.credits) {
      const price = calculatePrice(model.pricing.credits);
      response += `   Цена: ${formatPrice(price)} | `;
    }
    response += `${model.description.substring(0, 100)}${model.description.length > 100 ? '...' : ''}\n\n`;
  });

  ctx.replyWithMarkdown(response + 'Выберите модель из списка выше или используйте поиск.');
});

// Search models
bot.hears('🔍 Поиск', async (ctx) => {
  ctx.reply('Введите название модели или описание для поиска:');
  ctx.session = ctx.session || {};
  ctx.session.waitingForSearch = true;
});

// Back button handler
bot.hears('⬅️ Назад', (ctx) => {
  ctx.replyWithMarkdown('Главное меню:', mainMenuKeyboard());
});

// Balance/Оплата
bot.hears('💰 Баланс/Оплата', async (ctx) => {
  const userId = ctx.from.id;
  const user = await db.getUser(userId);
  const balance = user ? formatPrice(user.balance) : '0.00 ₽';

  let message = `💰 *Ваш баланс:* ${balance}\n\n`;
  message += `Для пополнения переведите средства на:\n\n${process.env.PAYMENT_REQUISITES_TEXT}\n\n`;
  message += 'После оплаты отправьте чек/скрин/ID администратору для подтверждения пополнения.';

  ctx.replyWithMarkdown(message);
});

// My Tasks
bot.hears('🧾 Мои задачи', async (ctx) => {
  const userId = ctx.from.id;
  const tasks = await db.getTasks();
  const userTasks = tasks.filter(t => t.userId === userId);

  if (userTasks.length === 0) {
    ctx.reply('📋 У вас пока нет задач.');
    return;
  }

  let response = '📋 *Ваши задачи:*\n\n';
  userTasks.slice(0, 10).forEach((task, index) => {
    response += `${index + 1}. ${task.modelType}\n`;
    response += `   Статус: ${task.status || 'unknown'}\n`;
    response += `   Создано: ${new Date(task.created_at).toLocaleString()}\n\n`;
  });

  if (userTasks.length > 10) {
    response += `И еще ${userTasks.length - 10} задач...`;
  }

  ctx.replyWithMarkdown(response);
});

// Profile
bot.hears('👤 Профиль', async (ctx) => {
  const userId = ctx.from.id;
  const user = await db.getUser(userId);

  if (!user) {
    ctx.reply('❌ Профиль не найден.');
    return;
  }

  ctx.replyWithMarkdown(
    `👤 *Ваш профиль*\n\n` +
    `ID: ${user.id}\n` +
    `Имя: ${user.first_name || 'Не указано'}\n` +
    `Username: ${user.username || 'Не указан'}\n` +
    `Баланс: ${formatPrice(user.balance)}\n` +
    `Дата регистрации: ${new Date(user.created_at).toLocaleDateString()}`
  );
});

// Help
bot.hears('🆘 Помощь', (ctx) => {
  ctx.replyWithMarkdown(
    `*Доступные команды:*\n\n` +
    `🎨 Модели - выбор нейросети для генерации\n` +
    `💰 Баланс/Оплата - информация о балансе и пополнение\n` +
    `🧾 Мои задачи - история ваших генераций\n` +
    `👤 Профиль - информация о вашем аккаунте\n` +
    `🆘 Помощь - это сообщение\n\n` +
    `Для администраторов: /admin`
  );
});

// Model selection and parameter collection
bot.on('text', async (ctx) => {
  if (ctx.session && ctx.session.waitingForSearch) {
    const query = ctx.message.text.toLowerCase();
    const models = await db.getModels();

    const searchResults = models.filter(model =>
      model.name.toLowerCase().includes(query) ||
      (model.description && model.description.toLowerCase().includes(query)) ||
      model.id.toLowerCase().includes(query)
    );

    if (searchResults.length === 0) {
      ctx.reply('❌ По вашему запросу ничего не найдено.');
    } else {
      let response = `Результаты поиска для "${query}":\n\n`;
      searchResults.slice(0, 10).forEach(model => {
        response += `• ${model.name} (${model.category})\n`;
        response += `  ${model.description.substring(0, 100)}${model.description.length > 100 ? '...' : ''}\n\n`;
      });

      if (searchResults.length > 10) {
        response += `\nИ еще ${searchResults.length - 10} моделей...`;
      }

      ctx.reply(response);
    }

    ctx.session.waitingForSearch = false;
    return;
  }

  // Check if we're collecting parameters for a model
  if (ctx.session && ctx.session.collectingParams) {
    const model = await db.getModel(ctx.session.modelId);
    if (!model) {
      ctx.reply('❌ Модель не найдена.');
      ctx.session = null;
      return;
    }

    const param = model.input_schema.properties[ctx.session.currentParam];
    if (!param) {
      ctx.reply('❌ Ошибка параметра.');
      ctx.session = null;
      return;
    }

    // Validate input based on parameter type
    let valid = true;
    let value;

    if (param.type === 'number') {
      value = parseFloat(ctx.message.text);
      if (isNaN(value)) {
        valid = false;
      } else if (param.minimum !== undefined && value < param.minimum) {
        ctx.reply(`❌ Значение должно быть не меньше ${param.minimum}`);
        valid = false;
      } else if (param.maximum !== undefined && value > param.maximum) {
        ctx.reply(`❌ Значение должно быть не больше ${param.maximum}`);
        valid = false;
      }
    } else if (param.type === 'string' && param.enum) {
      if (!param.enum.includes(ctx.message.text)) {
        ctx.reply(`❌ Допустимые значения: ${param.enum.join(', ')}`);
        valid = false;
      } else {
        value = ctx.message.text;
      }
    } else {
      value = ctx.message.text;
    }

    if (valid) {
      ctx.session.collectedParams[ctx.session.currentParam] = value;
      await collectNextParam(ctx, model);
    }

    return;
  }

  // Default text handler
  ctx.reply('Выберите действие из меню.');
});

// Handle media input
bot.on(['photo', 'video', 'audio', 'document'], async (ctx) => {
  if (ctx.session && ctx.session.collectingParams) {
    const model = await db.getModel(ctx.session.modelId);
    if (!model) {
      ctx.reply('❌ Модель не найдена.');
      ctx.session = null;
      return;
    }

    // Check if this model accepts media input
    if (ctx.session.currentParam === 'input_urls') {
      // If Supabase is configured, upload the file and get URL
      let mediaUrl;

      if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        // Get file info from Telegram
        try {
          const file = await ctx.telegram.getFile(ctx.message.photo ? ctx.message.photo.pop().file_id :
                                                   ctx.message.video ? ctx.message.video.file_id :
                                                   ctx.message.audio ? ctx.message.audio.file_id :
                                                   ctx.message.document.file_id);
          const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

          // For this example, we'll just use the Telegram file URL
          // In a real implementation, you'd download the file and upload to Supabase
          mediaUrl = fileUrl;
          ctx.session.collectedParams[ctx.session.currentParam] = [mediaUrl];

          await collectNextParam(ctx, model);
        } catch (error) {
          ctx.reply(`❌ Ошибка обработки файла: ${error.message}`);
        }
      } else {
        ctx.reply('❌ Для использования файлов необходимо предоставить URL файла. Введите URL вручную или настройте Supabase.');
      }
      return;
    }
  }

  ctx.reply('Для загрузки файлов выберите подходящую модель.');
});

// Function to collect next parameter for a model
async function collectNextParam(ctx, model) {
  const requiredParams = Object.keys(model.input_schema.properties).filter(key => {
    const param = model.input_schema.properties[key];
    return param.required === true || (param.required === undefined && param.type !== 'string'); // Consider non-string types as required by default
  });

  // Find the next parameter that hasn't been collected yet
  for (const paramKey of requiredParams) {
    if (ctx.session.collectedParams[paramKey] === undefined) {
      ctx.session.currentParam = paramKey;
      const param = model.input_schema.properties[paramKey];

      let prompt = `Введите значение для *${paramKey}*:`;
      if (param.description) {
        prompt += `\n${param.description}`;
      }

      if (param.type === 'number' && param.minimum !== undefined && param.maximum !== undefined) {
        prompt += `\n(Диапазон: ${param.minimum} - ${param.maximum})`;
      } else if (param.enum) {
        prompt += `\n(Допустимые значения: ${param.enum.join(', ')})`;
      }

      ctx.replyWithMarkdown(prompt);
      return;
    }
  }

  // All parameters collected, proceed to create task
  await createTask(ctx, model);
}

// Add a handler to select a specific model by name
// This would work once users can see the list of models
bot.hears(/^[A-Za-z0-9_.\-/]+$/, async (ctx) => {
  // Only process if we're not already collecting parameters
  if (ctx.session && ctx.session.collectingParams) {
    return; // Let the parameter collection handle it
  }

  const modelName = ctx.message.text;
  const models = await db.getModels();
  const selectedModel = models.find(m => m.name === modelName && m.enabled);

  if (selectedModel) {
    // Check if user is banned
    const user = await db.getUser(ctx.from.id);
    if (user && user.is_banned) {
      ctx.reply('❌ Вы заблокированы и не можете использовать модели.');
      return;
    }

    // Check if user has sufficient balance
    if (selectedModel.pricing && selectedModel.pricing.credits) {
      const price = calculatePrice(selectedModel.pricing.credits);
      if (user && user.balance < price) {
        ctx.reply(`❌ Недостаточно средств. Цена: ${formatPrice(price)}, баланс: ${formatPrice(user.balance)}`);
        return;
      }
    }

    // Start parameter collection
    ctx.session = ctx.session || {};
    ctx.session.modelId = selectedModel.id;
    ctx.session.collectingParams = true;
    ctx.session.collectedParams = {};
    ctx.session.currentParam = null;

    ctx.replyWithMarkdown(formatModelInfo(selectedModel) + '\n\nНачинаю сбор параметров...');
    await collectNextParam(ctx, selectedModel);
  }
});

// Function to create a task
async function createTask(ctx, model) {
  try {
    // Check if DRY_RUN mode is enabled
    if (process.env.DRY_RUN === '1') {
      // Mock response for testing
      ctx.reply(`✅ [TEST MODE] Задача создана для модели ${model.name}\nСтатус: done\nРезультат: mock_result_url`);

      // Save mock task
      const task = {
        id: `mock_${Date.now()}`,
        userId: ctx.from.id,
        modelType: model.id,
        input: ctx.session.collectedParams,
        status: 'done',
        result: { url: 'mock_result_url' },
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString()
      };

      await db.saveTask(task);
      ctx.session = null; // Reset session
      return;
    }

    // Check user balance and deduct cost if applicable
    let user = await db.getUser(ctx.from.id);
    let cost = 0;

    if (model.pricing && model.pricing.credits) {
      cost = calculatePrice(model.pricing.credits);
      if (user.balance < cost) {
        ctx.reply(`❌ Недостаточно средств. Цена: ${formatPrice(cost)}, баланс: ${formatPrice(user.balance)}`);
        ctx.session = null;
        return;
      }
    }

    ctx.reply('🔄 Создаю задачу...');

    // Create task in KIE
    const result = await kieApi.createTask(ctx.from.id, model.id, ctx.session.collectedParams);

    // Save task to database
    const task = {
      id: result.id || `task_${Date.now()}`,
      userId: ctx.from.id,
      modelType: model.id,
      input: ctx.session.collectedParams,
      status: result.status || 'queued',
      created_at: new Date().toISOString(),
      kie_response: result
    };

    await db.saveTask(task);

    // Deduct cost from user balance if applicable
    if (cost > 0) {
      await db.updateUser(ctx.from.id, { balance: user.balance - cost });
      ctx.reply(`✅ Задача создана! Списано: ${formatPrice(cost)}`);
    } else {
      ctx.reply('✅ Задача создана!');
    }

    // Start polling for task completion
    pollTaskStatus(ctx, task.id);

    ctx.session = null; // Reset session

  } catch (error) {
    console.error(`[BOT] Error creating task for user ${ctx.from.id}:`, error);
    ctx.reply(`❌ Ошибка создания задачи: ${error.message}`);
    ctx.session = null;
  }
}

// Poll for task status
async function pollTaskStatus(ctx, taskId) {
  const maxAttempts = 30; // Poll for up to 5 minutes (30 attempts * 10 seconds)
  let attempts = 0;

  const poll = async () => {
    try {
      attempts++;

      // Get task from DB
      let task = await db.getTask(taskId);
      if (!task) {
        console.error(`[POLL] Task ${taskId} not found in DB`);
        return;
      }

      // Get status from KIE if not in test mode
      if (process.env.DRY_RUN !== '1') {
        const statusInfo = await kieApi.getTaskInfo(ctx.from.id, taskId);

        // Update task status in DB
        task.status = statusInfo.status || task.status;
        task.kie_response = statusInfo;
        if (statusInfo.result) {
          task.result = statusInfo.result;
        }

        await db.saveTask(task);
      }

      // Check if task is complete
      if (task.status === 'done' || task.status === 'completed') {
        if (task.result && task.result.url) {
          ctx.reply(`✅ Готово! Результат: ${task.result.url}`);
        } else if (task.result) {
          ctx.reply('✅ Готово! Результат готов.');
        } else {
          ctx.reply('✅ Готово! Результат обработан.');
        }
        return;
      } else if (task.status === 'failed' || task.status === 'error') {
        ctx.reply('❌ Задача завершена с ошибкой.');
        return;
      } else {
        // Continue polling
        if (attempts < maxAttempts) {
          setTimeout(poll, 10000); // Poll every 10 seconds
        } else {
          ctx.reply('⏰ Время ожидания истекло. Проверьте задачу позже.');
        }
      }
    } catch (error) {
      console.error(`[POLL] Error polling task ${taskId}:`, error);
      if (attempts < maxAttempts) {
        setTimeout(poll, 10000); // Continue polling despite error
      } else {
        ctx.reply('❌ Ошибка проверки статуса задачи.');
      }
    }
  };

  setTimeout(poll, 10000); // Start polling after 10 seconds
}

// Admin commands
bot.command('syncmodels', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    ctx.reply('❌ Только администратор может выполнить эту команду.');
    return;
  }

  ctx.reply('🔄 Запускаю синхронизацию моделей...');
  try {
    await import('./scripts/kie-sync.mjs').then(sync => sync.syncModels());
    const models = await db.getModels();
    ctx.reply(`✅ Синхронизация завершена! Модели: ${models.length} всего, ${models.filter(m => m.enabled).length} включено.`);
  } catch (error) {
    ctx.reply(`❌ Ошибка синхронизации: ${error.message}`);
  }
});

bot.command('setrate', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    ctx.reply('❌ Только администратор может выполнить эту команду.');
    return;
  }

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    ctx.reply('❌ Использование: /setrate <новый_курс>');
    return;
  }

  const newRate = parseFloat(args[1]);
  if (isNaN(newRate)) {
    ctx.reply('❌ Курс должен быть числом');
    return;
  }

  try {
    const currentSettings = await db.getSettings();
    const updatedSettings = { ...currentSettings, USD_TO_RUB: newRate };
    await db.updateSettings(updatedSettings);

    ctx.reply(`✅ Курс USD/RUB изменен на: ${newRate}`);
    console.log(`[ADMIN] User ${userId} changed USD_TO_RUB rate to ${newRate}`);
  } catch (error) {
    ctx.reply(`❌ Ошибка обновления курса: ${error.message}`);
  }
});

bot.command('setmarkup', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    ctx.reply('❌ Только администратор может выполнить эту команду.');
    return;
  }

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    ctx.reply('❌ Использование: /setmarkup <новая_наценка>');
    return;
  }

  const newMarkup = parseFloat(args[1]);
  if (isNaN(newMarkup)) {
    ctx.reply('❌ Наценка должна быть числом');
    return;
  }

  try {
    const currentSettings = await db.getSettings();
    const updatedSettings = { ...currentSettings, MARKUP: newMarkup };
    await db.updateSettings(updatedSettings);

    ctx.reply(`✅ Наценка изменена на: ${newMarkup}x`);
    console.log(`[ADMIN] User ${userId} changed markup to ${newMarkup}`);
  } catch (error) {
    ctx.reply(`❌ Ошибка обновления наценки: ${error.message}`);
  }
});

bot.command('addbalance', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    ctx.reply('❌ Только администратор может выполнить эту команду.');
    return;
  }

  const args = ctx.message.text.split(' ');
  if (args.length < 3) {
    ctx.reply('❌ Использование: /addbalance <userId> <сумма>');
    return;
  }

  const targetUserId = parseInt(args[1]);
  const amount = parseFloat(args[2]);

  if (isNaN(targetUserId) || isNaN(amount)) {
    ctx.reply('❌ UserId и сумма должны быть числами');
    return;
  }

  try {
    let user = await db.getUser(targetUserId);
    if (!user) {
      ctx.reply(`❌ Пользователь с ID ${targetUserId} не найден`);
      return;
    }

    const newBalance = user.balance + amount;
    await db.updateUser(targetUserId, { balance: newBalance });

    ctx.reply(`✅ Баланс пользователя ${targetUserId} пополнен на ${formatPrice(amount)}. Новый баланс: ${formatPrice(newBalance)}`);
    console.log(`[ADMIN] User ${userId} added ${amount} to user ${targetUserId} balance`);
  } catch (error) {
    ctx.reply(`❌ Ошибка пополнения баланса: ${error.message}`);
  }
});

bot.command('ban', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    ctx.reply('❌ Только администратор может выполнить эту команду.');
    return;
  }

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    ctx.reply('❌ Использование: /ban <userId>');
    return;
  }

  const targetUserId = parseInt(args[1]);
  if (isNaN(targetUserId)) {
    ctx.reply('❌ UserId должен быть числом');
    return;
  }

  try {
    await db.updateUser(targetUserId, { is_banned: true });
    ctx.reply(`✅ Пользователь ${targetUserId} заблокирован`);
    console.log(`[ADMIN] User ${userId} banned user ${targetUserId}`);
  } catch (error) {
    ctx.reply(`❌ Ошибка блокировки: ${error.message}`);
  }
});

bot.command('unban', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    ctx.reply('❌ Только администратор может выполнить эту команду.');
    return;
  }

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    ctx.reply('❌ Использование: /unban <userId>');
    return;
  }

  const targetUserId = parseInt(args[1]);
  if (isNaN(targetUserId)) {
    ctx.reply('❌ UserId должен быть числом');
    return;
  }

  try {
    await db.updateUser(targetUserId, { is_banned: false });
    ctx.reply(`✅ Пользователь ${targetUserId} разблокирован`);
    console.log(`[ADMIN] User ${userId} unbanned user ${targetUserId}`);
  } catch (error) {
    ctx.reply(`❌ Ошибка разблокировки: ${error.message}`);
  }
});

bot.command('stats', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    ctx.reply('❌ Только администратор может выполнить эту команду.');
    return;
  }

  try {
    const users = await db.getUsers();
    const tasks = await db.getTasks();
    const models = await db.getModels();
    const enabledModels = models.filter(m => m.enabled);

    const totalBalance = users.reduce((sum, user) => sum + user.balance, 0);

    let response = '📊 *Статистика бота:*\n\n';
    response += `Пользователей: ${users.length}\n`;
    response += `Задач: ${tasks.length}\n`;
    response += `Моделей: ${models.length} всего, ${enabledModels.length} включено\n`;
    response += `Общий баланс пользователей: ${formatPrice(totalBalance)}\n`;

    ctx.replyWithMarkdown(response);
  } catch (error) {
    ctx.reply(`❌ Ошибка получения статистики: ${error.message}`);
  }
});

// Self-check command for diagnostics
bot.command('selfcheck', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    ctx.reply('❌ Только администратор может запустить self-check.');
    return;
  }

  ctx.reply('🔍 Запускаю диагностику...');

  try {
    // Check models
    const models = await db.getModels();
    const enabledModels = models.filter(m => m.enabled);

    // Check KIE API
    const apiOk = await kieApi.healthCheck();

    let response = '📋 *Результаты диагностики:*\n\n';
    response += `Модели: ${models.length} всего, ${enabledModels.length} включено\n`;
    response += `KIE API: ${apiOk ? '✅ Доступен' : '❌ Недоступен'}\n`;
    response += `База данных: ✅ Работает\n`;

    ctx.replyWithMarkdown(response);
  } catch (error) {
    ctx.reply(`❌ Ошибка диагностики: ${error.message}`);
  }
});

// On bot launch
async function startBot() {
  console.log('[BOT] Initializing database and models...');
  await runDoctor();
  
  const models = await db.getModels();
  console.log(`Models loaded: ${models.length} total, ${models.filter(m => m.enabled).length} enabled`);
  
  console.log('[BOT] Starting Telegram bot...');
  await bot.launch();
  console.log('[BOT] READY - Bot is running!');
  
  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

// Start the bot
startBot().catch(console.error);