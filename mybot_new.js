import { Telegraf, Markup } from 'telegraf';
import { Scenes, session } from 'telegraf';
import dotenv from 'dotenv';
import db from './src/db_memory.js';  // Updated to use in-memory database
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
  logger.logError(new Error(`Missing required environment variables: ${missingEnv.join(', ')}`));
  console.error('[BOT] Missing required environment variables:', missingEnv);
  console.error('[BOT] Please check your .env file and .env.example for required variables');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// Check if user is admin (real admin status)
function isRealAdmin(userId) {
  if (!process.env.ADMIN_IDS) return false;
  const adminIds = process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim()));
  return adminIds.includes(userId);
}

// Check if user is admin and not in user view mode
function isAdmin(userId) {
  if (!isRealAdmin(userId)) {
    return false;
  }
  // If admin is in user view mode, return false to make them appear as regular user
  return !isAdminInUserViewMode(userId);
}

// Format price for display using accurate calculation from database
function formatPrice(credits) {
  // Calculate accurate price using standard calculation: credits * usd_per_credit * usd_to_rub_rate * markup
  // For standard pricing: 1 credit ≈ $0.005 (based on API info), USD/RUB ≈ 77.46, markup = 2
  const rubles = credits * 0.005 * 77.46 * 2; // credits * usd_per_credit * usd_to_rub_rate * markup
  return (Math.round(rubles * 100) / 100) + ' ₽';  // Round to 2 decimal places
}

// Safe format price that escapes markdown using accurate calculation
function formatPriceSafe(credits) {
  // Use the same accurate calculation but with markdown escaping
  const rubles = credits * 0.005 * 77.46 * 2; // credits * usd_per_credit * usd_to_rub_rate * markup
  return escapeMarkdown((Math.round(rubles * 100) / 100) + ' ₽');  // Round to 2 decimal places
}

// Convert credits to rubles without formatting using accurate calculation
function convertCreditsToRubles(credits) {
  // Standard calculation: credits * usd_per_credit * usd_to_rub_rate * markup
  return credits * 0.005 * 77.46 * 2; // credits * usd_per_credit * usd_to_rub_rate * markup
}

// Calculate price in rubles
// Calculate price in rubles based on credits and dynamic exchange rate
async function calculatePriceInRub(credits) {
  // For more accurate pricing, we should get the model-specific USD price and convert
  // Since we may not have model-specific data here, we'll use a standard conversion
  // In a real implementation, each model would have its own USD price

  try {
    // Convert credits to approximate USD value based on typical pricing
    // This value might need adjustment based on actual KIE pricing
    const usdPerCredit = 0.005; // Approximate USD value per credit (tunable)
    const usdPrice = credits * usdPerCredit;

    // Use database method to calculate final price in rubles
    const rubPrice = await db.calculatePriceInRub(usdPrice);
    return Math.round(rubPrice * 100) / 100; // Round to 2 decimal places
  } catch (error) {
    logger.logError(error, `Error calculating price in rubles for ${credits} credits`);
    // Fallback to original calculation
    return Math.round(credits * 0.78); // Return rounded ruble value as fallback
  }
}

// Legacy function kept for compatibility
function calculatePrice(credits) {
  // Standard conversion rate: 1 credit = 0.78 RUB (legacy calculation)
  return Math.round(credits * 0.78); // Return rounded ruble value
}

// Main menu with multiple model options
function mainMenuInlineKeyboard(userId) {
  const isAdminUser = isAdmin(userId);

  const keyboard = [
    [
      { text: '🖼️ Z-Image (фото)', callback_data: 'model_z-image' },
      { text: '🎬 Seedream 4.5 (фото)', callback_data: 'model_seedream-4.5' }
    ],
    [
      { text: '💰 Баланс/Оплата', callback_data: 'balance_payment' },
      { text: '🧾 Мои задачи', callback_data: 'my_tasks' }
    ],
    [
      { text: '👤 Профиль', callback_data: 'profile' },
      { text: '🆘 Помощь', callback_data: 'help' }
    ]
  ];

  // Add admin button if user is admin
  if (isAdminUser) {
    keyboard.push([{ text: '👑 Админ', callback_data: 'admin_panel' }]);
  }

  return Markup.inlineKeyboard(keyboard);
}

// Category inline keyboard
function categoryMenuInlineKeyboard(category) {
  return Markup.inlineKeyboard([
    [{ text: '◀️ Назад', callback_data: 'main_menu' }]
  ]);
}

// Helper function to escape markdown characters
function escapeMarkdown(text) {
  if (typeof text !== 'string') return text;
  // Escape special markdown characters
  return text
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/>/g, '\\>')
    .replace(/#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/\-/g, '\\-')
    .replace(/=/g, '\\=')
    .replace(/\|/g, '\\|')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\./g, '\\.')
    .replace(/\!/g, '\\!');
}

// Function to format model names in Russian with beautiful description
function formatModelDisplayName(model) {
  // First, try to extract information from the model ID to create a beautiful display name
  const modelId = model.id.toLowerCase();

  // Handle Flux models
  if (modelId.includes('flux-2')) {
    if (modelId.includes('pro-text-to-image')) {
      return '_flux-2/pro-text-to-image_ | из текста в фото (Flux Pro)';
    } else if (modelId.includes('pro-image-to-image')) {
      return '_flux-2/pro-image-to-image_ | из фото в фото (Flux Pro)';
    } else if (modelId.includes('flex-text-to-image')) {
      return '_flux-2/flex-text-to-image_ | из текста в фото (Flux Flex)';
    } else if (modelId.includes('flex-image-to-image')) {
      return '_flux-2/flex-image-to-image_ | из фото в фото (Flux Flex)';
    } else {
      // Default case
      const type = modelId.includes('text-to-image') ? 'из текста в фото' :
                   modelId.includes('image-to-image') ? 'из фото в фото' : 'другое';
      const variant = modelId.includes('pro') ? 'Flux Pro' :
                    modelId.includes('flex') ? 'Flux Flex' : 'Flux';
      return `${model.name} | ${type} (${variant})`;
    }
  }
  // Handle ByteDance models
  else if (modelId.includes('bytedance')) {
    if (modelId.includes('image-to-video')) {
      return 'bytedance | из фото в видео (ByteDance)';
    } else if (modelId.includes('text-to-video')) {
      return 'bytedance | из текста в видео (ByteDance)';
    } else {
      return `${model.name} | видео (ByteDance)`;
    }
  }
  // Handle Grok Imagine models
  else if (modelId.includes('grok-imagine')) {
    if (modelId.includes('text-to-image')) {
      return 'grok-imagine | из текста в фото (xAI)';
    } else if (modelId.includes('text-to-video')) {
      return 'grok-imagine | из текста в видео (xAI)';
    } else if (modelId.includes('image-to-video')) {
      return 'grok-imagine | из фото в видео (xAI)';
    } else if (modelId.includes('upscale')) {
      return 'grok-imagine | апскейл (xAI)';
    } else {
      return `${model.name} | (xAI)`;
    }
  }
  // Handle Hailuo models
  else if (modelId.includes('hailuo')) {
    if (modelId.includes('image-to-video')) {
      const variant = modelId.includes('pro') ? 'Hailuo Pro' : 'Hailuo';
      return 'hailuo | из фото в видео (' + variant + ')';
    } else {
      return `${model.name} | видео (Hailuo)`;
    }
  }
  // Handle Sora models
  else if (modelId.includes('sora')) {
    return 'sora | видео (OpenAI)';
  }
  // Handle nano-banana-pro
  else if (modelId.includes('nano-banana')) {
    return 'nano-banana-pro | из текста в фото (Google DeepMind)';
  }
  // Default case - return original format but with Russian terms
  else {
    let type = 'другое';
    if (modelId.includes('text-to-image') || modelId.includes('text2img')) {
      type = 'из текста в фото';
    } else if (modelId.includes('image-to-image') || modelId.includes('img2img')) {
      type = 'из фото в фото';
    } else if (modelId.includes('text-to-video') || modelId.includes('text2video')) {
      type = 'из текста в видео';
    } else if (modelId.includes('image-to-video') || modelId.includes('img2video')) {
      type = 'из фото в видео';
    } else if (modelId.includes('audio') || modelId.includes('voice') || modelId.includes('tts') || modelId.includes('stt')) {
      type = 'аудио';
    } else if (modelId.includes('upscale') || modelId.includes('enhance')) {
      type = 'апскейл/улучшение';
    }

    // Extract vendor from group if available
    let vendor = model.group || '';
    if (!vendor && model.name) {
      // Try to identify vendor from name
      if (model.name.toLowerCase().includes('deepmind')) vendor = 'Google DeepMind';
      else if (model.name.toLowerCase().includes('flux')) vendor = 'Flux';
      else if (model.name.toLowerCase().includes('grok')) vendor = 'xAI';
      else if (model.name.toLowerCase().includes('openai')) vendor = 'OpenAI';
      else if (model.name.toLowerCase().includes('bytedance')) vendor = 'ByteDance';
    }

    const vendorText = vendor ? ` (${vendor})` : '';
    return `${model.name} | ${type}${vendorText}`;
  }
}

// Function to prepare input parameters for API based on model type
function prepareApiInputParams(modelType, inputParams) {
  // Create a copy of inputParams to avoid modifying the original
  const params = { ...inputParams };

  // Remove any undefined or null values to avoid API errors
  Object.keys(params).forEach(key => {
    if (params[key] === null || params[key] === undefined || params[key] === '') {
      delete params[key];
    }
  });

  // Base processing - ensure prompt exists and is properly formatted
  if (params.prompt && typeof params.prompt === 'string') {
    // Ensure prompt is not too long (truncate if necessary)
    if (params.prompt.length > 5000) {
      params.prompt = params.prompt.substring(0, 5000);
    }
  }

  // Model-specific parameter adjustments

  // Special handling for Z-Image model
  if (modelType.includes('z-image')) {
    // Z-Image expects parameters within an 'input' object
    const result = {
      model: modelType,
      input: {}
    };

    // Add prompt to input object
    if (params.prompt) {
      result.input.prompt = params.prompt;
    } else {
      // Ensure there is always a prompt
      result.input.prompt = 'Default image generation';
    }

    // Add aspect ratio
    if (params.aspect_ratio) {
      result.input.aspect_ratio = params.aspect_ratio;
    } else {
      // Set default aspect ratio if not provided
      result.input.aspect_ratio = '1:1'; // Default to 1:1 for square format
    }

    return result;
  }

  // Special handling for Seedream/4.5 model
  else if (modelType.includes('seedream/4.5-text-to-image')) {
    // Seedream/4.5 expects parameters within an 'input' object
    const result = {
      model: modelType,
      input: {}
    };

    // Add prompt to input object (required)
    if (params.prompt) {
      result.input.prompt = params.prompt;
    } else {
      // Ensure there is always a prompt
      result.input.prompt = 'Default image generation';
    }

    // Add aspect ratio (required)
    if (params.aspect_ratio) {
      result.input.aspect_ratio = params.aspect_ratio;
    } else {
      // Set default aspect ratio if not provided
      result.input.aspect_ratio = '1:1'; // Default to 1:1 for square format
    }

    // Add quality (required)
    if (params.quality) {
      result.input.quality = params.quality;
    } else {
      // Set default quality if not provided
      result.input.quality = 'basic'; // Default to basic quality
    }

    return result;
  }

  // Special handling for Flux models - ensure proper structure with model and input
  else if (modelType.includes('flux-2')) {
    // For Flux models - ensure proper structure
    const result = {
      model: modelType,
      input: {}
    };

    if (params.prompt) {
      result.input.prompt = params.prompt;
    }
    if (params.image_input && params.image_input.length > 0) {
      result.input.input_urls = params.image_input;
    }
    if (params.aspect_ratio) {
      result.input.aspect_ratio = params.aspect_ratio;
    }
    if (params.resolution) {
      result.input.resolution = params.resolution;
    }

    return result;
  }
  else if (modelType.includes('bytedance')) {
    // For ByteDance models - ensure correct structure with model and input
    const result = {
      model: modelType,
      input: {}
    };

    if (params.prompt) {
      result.input.prompt = params.prompt;
    } else if (params.text) {
      result.input.prompt = params.text;
    }
    if (params.image_input && Array.isArray(params.image_input) && params.image_input.length > 0) {
      result.input.image_url = params.image_input[0]; // Use first image for ByteDance models
    }

    return result;
  }
  else if (modelType.includes('grok-imagine')) {
    // For Grok Imagine models - ensure correct structure with model and input
    const result = {
      model: modelType,
      input: {}
    };

    if (params.image_input && Array.isArray(params.image_input) && params.image_input.length > 0) {
      // Map image_input to correct field for Grok models
      result.input.image_urls = params.image_input;
    }
    if (params.prompt) {
      result.input.prompt = params.prompt;
    }

    return result;
  }
  else if (modelType.includes('hailuo')) {
    // For Hailuo models - ensure correct structure with model and input
    const result = {
      model: modelType,
      input: {}
    };

    if (params.image_input && Array.isArray(params.image_input) && params.image_input.length > 0) {
      result.input.image_url = params.image_input[0]; // Use first image
    }
    if (params.prompt) {
      result.input.prompt = params.prompt;
    }

    return result;
  }
  else if (modelType.includes('sora')) {
    // For Sora models - ensure correct structure with model and input
    const result = {
      model: modelType,
      input: {}
    };

    if (params.prompt) {
      result.input.prompt = params.prompt;
    }
    // Sora typically only accepts text prompts - remove image inputs
    // (no need to explicitly delete image_input as it won't be added)

    return result;
  }
  else if (modelType.includes('nano-banana')) {
    // For nano-banana models - ensure correct structure with model and input
    const result = {
      model: modelType,
      input: {}
    };

    if (params.image_input && Array.isArray(params.image_input) && params.image_input.length > 0) {
      // Map image_input to correct field for nano-banana models
      result.input.image_urls = params.image_input;
    }
    if (params.prompt) {
      result.input.prompt = params.prompt;
    }
    if (params.aspect_ratio) {
      result.input.aspect_ratio = params.aspect_ratio;
    }
    if (params.resolution) {
      result.input.resolution = params.resolution;
    }
    if (params.output_format) {
      result.input.output_format = params.output_format;
    }

    return result;
  }
  else {
    // For any other model type, do generic preparation
    // Convert common field names to expected formats
    if (params.image_input && Array.isArray(params.image_input) && params.image_input.length > 0) {
      // Use most appropriate field name based on common conventions
      const modelFamily = modelType.split('/')[0]; // Get model family
      if (['flux', 'midjourney', 'dalle', 'stability'].includes(modelFamily)) {
        params.input_urls = params.image_input;
      } else {
        params.image_urls = params.image_input;
      }
      delete params.image_input;
    }
  }

  // Return object with model field for all models that don't need special structure
  const result = {
    model: modelType,
    ...params
  };

  // Remove any undefined properties to avoid API issues
  Object.keys(result).forEach(key => {
    if (result[key] === undefined) {
      delete result[key];
    }
  });

  return result;
}

// Format model info for z-image only (simplified version)
function formatModelInfo(model, isUserAdmin = false) {
  let text = `🖼️ *${escapeMarkdown(model.name)}*\n\n`;
  text += `*Группа:* ${escapeMarkdown(model.group)}\n`;

  if (isUserAdmin) {
    // For admin users, indicate that generation is free
    text += `*Цена:* Бесплатно для администраторов\n`;

    // Show original pricing for info
    if (model.pricing && model.pricing.credits) {
      const originalPrice = formatPriceSafe(model.pricing.credits * 0.005 * 77.46 * 2); // 0.8 * 0.005 * 77.46 * 2
      text += `*Оригинальная цена:* ${originalPrice} (0.8 кредита ≈ $0.004)\n`;
    }
  } else {
    // Regular user pricing
    if (model.pricing && model.pricing.credits) {
      const price = formatPriceSafe(model.pricing.credits * 0.005 * 77.46 * 2); // 0.8 * 0.005 * 77.46 * 2
      text += `*Цена:* ${price} (0.8 кредита ≈ $0.004)\n`;
    } else {
      text += `*Цена:* Уточняйте перед использованием\n`;
    }
  }

  if (model.description) {
    text += `*Описание:* ${escapeMarkdown(model.description.substring(0, 200))}${model.description.length > 200 ? '...' : ''}\n`;
  }

  if (model.input_schema && model.input_schema.properties) {
    const requiredFields = Object.keys(model.input_schema.properties);
    if (requiredFields.length > 0) {
      text += `*Требуемые параметры:* ${escapeMarkdown(requiredFields.join(', '))}\n`;
    }
  }

  return text;
}

// Enhanced format model info for admin users - DEPRECATED, use formatModelInfo with isUserAdmin=true instead
function formatModelInfoAdmin(model) {
  return formatModelInfo(model, true);
}

// Error handling middleware
bot.use(async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    // Generate error code
    const errorCode = 'ERR_' + Date.now();

    // Detailed error information for logging
    const errorDetails = {
      timestamp: new Date().toISOString(),
      errorCode: errorCode,
      userId: ctx.from?.id || 'unknown',
      userType: ctx.from ? (isAdmin(ctx.from.id) ? 'admin' : 'user') : 'unknown',
      chatId: ctx.chat?.id || 'unknown',
      updateType: ctx.updateType,
      callbackQuery: ctx.callbackQuery?.data || 'none',
      messageText: ctx.message?.text || 'none',
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack
    };

    logger.logError('BOT', `Error processing update`, errorDetails);

    // For users, send friendly message without technical details
    // For admins, we can provide more detailed feedback internally but still user-friendly in chat
    try {
      if (ctx.update.callback_query) {
        await ctx.answerCbQuery(`❌ Произошла внутренняя ошибка. Уже чиню... (код: ${errorCode})`, { show_alert: true });
      } else {
        await ctx.reply(`❌ Произошла внутренняя ошибка. Уже чиню... (код: ${errorCode})`);
      }
    } catch (replyError) {
      logger.logError('BOT', `Failed to send error message to user`, {
        errorCode: errorCode,
        originalError: error.message,
        replyError: replyError.message
      });
    }
  }
});

// On bot start
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  logger.logBot(`User ${userId} started the bot`);
  
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
    logger.logBot(`Created new user: ${userId}`);
  } else {
    // Update user info
    await db.updateUser(userId, {
      username: ctx.from.username,
      first_name: ctx.from.first_name
    });
  }
  
  const balance = formatPrice(user.balance);

  try {
    await ctx.replyWithMarkdown(
      `🎉 *Добро пожаловать в KIE AI BOT!*\n\n` +
      `💥 *Все нейросети в одном боте по лучшим ценам!*\n\n` +
      `💰 *Ваш баланс:* ${escapeMarkdown(balance)}\n\n` +
      `✨ У нас вы найдете:\n` +
      `🖼️ Генерация фото и видео\n` +
      `🎭 Текст-в-изображение и изображение-в-изображение\n` +
      `🚀 Модели от OpenAI, Google DeepMind, xAI, MiniMax и других лидеров\n` +
      `⚡ Высокая скорость генерации\n` +
      `🎯 Лучшие цены - ЭКОНОМИТЕ до 75% по сравнению с официальными!\n\n` +
      `✨ *Текущий статус:* ${isAdmin(userId) ? '👑 Администратор (бесплатная генерация)' : '👤 Пользователь'}\n\n` +
      `Выберите интересующую вас категорию:`,
      mainMenuInlineKeyboard(userId)
    );
  } catch (error) {
    logger.logError(error, `Failed to send start message to user ${userId}`);
  }
});

// Help command
bot.help(async (ctx) => {
  const userId = ctx.from.id;
  logger.logBot(`User ${userId} requested help`);
  
  try {
    await ctx.replyWithMarkdown(
      `*Доступные команды:*\n\n` +
      `🎨 Фото - генерация изображений\n` +
      `🎬 Видео - генерация видео\n` +
      `🎧 Аудио - обработка аудио\n` +
      `🧩 Инструменты - прочие инструменты\n` +
      `🔎 Поиск моделей - поиск по названию или описанию\n` +
      `💰 Баланс/Оплата - информация о балансе и пополнение\n` +
      `🧾 Мои задачи - история ваших генераций\n` +
      `👤 Профиль - информация о вашем аккаунте\n` +
      `🆘 Помощь - это сообщение\n\n` +
      (isAdmin(userId)
        ? `Для администраторов: /admin\n` +
          `Для переключения режима просмотра:\n` +
          `/usermode - режим просмотра как обычный пользователь\n` +
          `/adminmode - режим администратора`
        : `Для администраторов: /admin`)
    );
  } catch (error) {
    logger.logError(error, `Failed to send help message to user ${userId}`);
  }
});

// Admin command
bot.command('admin', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    try {
      await ctx.reply('❌ У вас нет прав администратора.');
    } catch (error) {
      logger.logError(error, `Failed to send admin error to user ${userId}`);
    }
    return;
  }

  try {
    const isInUserViewMode = isAdminInUserViewMode(userId);
    const modeText = isInUserViewMode ? 'Пользовательский режим (смотрите бота как обычный пользователь)' : 'Администраторский режим (стандартный режим)';

    await ctx.replyWithMarkdown(
      `*Панель администратора*\n\n` +
      `*Текущий режим:* ${modeText}\n\n` +
      `/admin - главное меню администратора\n` +
      `/usermode - переключиться в режим просмотра как обычный пользователь\n` +
      `/adminmode - переключиться обратно в режим администратора\n` +
      `/checkconnection - проверить подключение к API\n` +
      `/syncmodels - синхронизировать модели\n` +
      `/setrate <rate> - установить курс USD/RUB\n` +
      `/setmarkup <markup> - установить наценку\n` +
      `/addbalance <userId> <amount> - пополнить баланс\n` +
      `/ban <userId> - заблокировать пользователя\n` +
      `/unban <userId> - разблокировать пользователя\n` +
      `/stats - статистика использования`
    );
  } catch (error) {
    logger.logError(error, `Failed to send admin panel to user ${userId}`);
  }
});

// Check connection command for admins
bot.command('checkconnection', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    try {
      await ctx.reply('❌ У вас нет прав администратора для выполнения этой команды.');
    } catch (error) {
      logger.logError(error, `Failed to send connection check error to user ${userId}`);
    }
    return;
  }

  try {
    await ctx.reply('🔍 Проверяю подключение к KIE API и Supabase...');

    // Check KIE API connection
    let kieResult;
    try {
      kieResult = await kieApi.testApiKey();
    } catch (error) {
      kieResult = {
        success: false,
        message: `Ошибка при проверке KIE API: ${error.message}`,
        error: error.message
      };
    }

    // Check Supabase connection
    let supabaseResult;
    try {
      const hasConnection = await db.checkSupabaseConnection();
      if (hasConnection) {
        supabaseResult = {
          success: true,
          message: '✅ Supabase: подключение активно и стабильно'
        };
      } else if (db.supabase) {
        // Try basic connectivity test
        const testResult = await db.getUsers();
        supabaseResult = {
          success: !!testResult,
          message: testResult ? '✅ Supabase: подключение активно и работает' :
                          '❌ Supabase: подключение настроено, но возникли проблемы при тесте'
        };
      } else {
        supabaseResult = {
          success: false,
          message: '⚠️ Supabase: не настроено (используется резервное хранилище)'
        };
      }
    } catch (error) {
      supabaseResult = {
        success: false,
        message: `❌ Supabase: ошибка при проверке подключения - ${error.message}`
      };
    }

    // Format response
    let response = `📡 *Результаты проверки подключения*\n\n`;
    response += `*KIE API*:\n`;
    if (kieResult.success) {
      response += `✅ ${kieResult.message}\n`;
      if (kieResult.response) {
        response += `   Код ответа: ${kieResult.response.code || 'unknown'}, `;
        response += `Сообщение: ${kieResult.response.msg || 'no message'}\n`;
      }
    } else {
      response += `❌ ${kieResult.message}\n`;
    }

    response += `\n*Supabase*:\n`;
    response += `${supabaseResult.message}\n`;

    // Add additional info based on configuration
    response += `\n*Конфигурация*:\n`;
    response += `KIE_API_KEY: ${process.env.KIE_API_KEY ? 'установлен' : 'не установлен'}\n`;
    response += `SUPABASE_URL: ${process.env.SUPABASE_URL ? 'установлен' : 'не установлен'}\n`;
    response += `SUPABASE_ANON_KEY: ${process.env.SUPABASE_ANON_KEY ? 'установлен' : 'не установлен'}\n`;
    response += `DRY_RUN: ${process.env.DRY_RUN === '1' ? 'активен (тестовый режим)' : 'неактивен (реальный режим)'}\n`;

    await ctx.replyWithMarkdown(response);
  } catch (error) {
    logger.logError(error, `Failed to check connections for user ${userId}`);
    try {
      await ctx.reply(`❌ Ошибка при проверке подключений: ${error.message}`);
    } catch (replyError) {
      logger.logError(replyError, `Failed to send connection check error message`);
    }
  }
});

// Command to check KIE account balance
bot.command('checkbalance', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    try {
      await ctx.reply('❌ У вас нет прав администратора для выполнения этой команды.');
    } catch (error) {
      logger.logError(error, `Failed to send balance check error to user ${userId}`);
    }
    return;
  }

  try {
    await ctx.reply('💰 Проверяю баланс на аккаунте KIE...');

    // Get account balance from API
    let balanceResult;
    try {
      balanceResult = await kieApi.getAccountBalance();
    } catch (error) {
      balanceResult = {
        success: false,
        message: `Ошибка при проверке баланса: ${error.message}`,
        error: error.message
      };
    }

    let response = `💳 *Баланс аккаунта KIE*\n\n`;
    if (balanceResult.success) {
      response += `✅ Баланс: ${balanceResult.balance} кредитов\n`;
      response += `ℹ️ ${escapeMarkdown(balanceResult.message)}\n`;
      if (balanceResult.response) {
        // Instead of including full JSON response (which can break markdown), just show key fields
        const responseSummary = {
          code: balanceResult.response.code,
          message: balanceResult.response.msg,
          remaining: balanceResult.response.remaining_credits || balanceResult.response.credits
        };
        response += `📋 Статус: ${escapeMarkdown(JSON.stringify(responseSummary))}\n`;
      }
    } else {
      response += `❌ ${escapeMarkdown(balanceResult.message)}\n`;
      if (balanceResult.error) {
        response += `⚠️ Ошибка: ${escapeMarkdown(balanceResult.error)}\n`;
      }
    }

    response += `\n*Конфигурация*:\n`;
    response += `DRY_RUN: ${process.env.DRY_RUN === '1' ? escapeMarkdown('активен (тестовый режим)') : escapeMarkdown('неактивен (реальный режим)')}\n`;

    await ctx.reply(response);
  } catch (error) {
    logger.logError(error, `Failed to check balance for user ${userId}`);
    try {
      await ctx.reply(`❌ Ошибка при проверке баланса: ${error.message}`);
    } catch (replyError) {
      logger.logError(replyError, `Failed to send balance check error message`);
    }
  }
});

// Track user states for multi-step operations
const userStates = new Map(); // In production, use a proper database or Redis

// Track admin user view mode (to see bot as regular user)
const adminViewModes = new Map(); // userId -> boolean (true if in user view mode)

// Track user states for balance recharge
const rechargeStates = new Map(); // userId -> { amount: number, timestamp: number }

// Track payment screenshots for admin review
const paymentScreenshots = []; // Array of { userId, amount, timestamp, status, imageUrl, adminReviewed }

// Check if admin is in user view mode
function isAdminInUserViewMode(userId) {
  return adminViewModes.get(userId) === true;
}

// Add cleanup function for expired states (to prevent memory leaks)
function cleanupExpiredStates() {
  const now = Date.now();
  for (const [userId, state] of userStates.entries()) {
    // If state is older than 10 minutes, remove it
    if (state.timestamp && (now - state.timestamp) > 10 * 60 * 1000) { // 10 minutes
      userStates.delete(userId);
    }
  }

  // Clean up old request counts (older than 10 minutes)
  for (const [userId, requests] of userRequestCount.entries()) {
    const recentRequests = requests.filter(time => (now - time) < 10 * 60 * 1000);
    if (recentRequests.length === 0) {
      userRequestCount.delete(userId);
    } else {
      userRequestCount.set(userId, recentRequests);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredStates, 5 * 60 * 1000);

// Rate limiting variables
const userRequestCount = new Map(); // Track requests by user
const requestLimits = {
  windowMs: 60000, // 1 minute
  maxRequests: 10 // max 10 requests per minute per user
};

// Handle text messages for model parameter input
bot.on('text', async (ctx) => {
  logger.logBot(`[ULTRA_LOG] Text message handler triggered`, {
    userId: ctx.from.id,
    chatId: ctx.chat.id,
    messageText: ctx.message.text,
    messageTextLength: ctx.message.text?.length,
    messageEntityType: ctx.message.entities ? 'has_entities' : 'no_entities',
    userStateExists: userStates.has(ctx.from.id),
    userState: userStates.get(ctx.from.id),
    isAdmin: isAdmin(ctx.from.id),
    timestamp: Date.now(),
    triggerPoint: 'text_handler_start'
  });

  const userId = ctx.from.id;
  const userState = userStates.get(userId);

  logger.logBot(`[ULTRA_LOG] After getting user state`, {
    userId: userId,
    userState: userState,
    userStateMode: userState?.mode,
    userStateModelId: userState?.modelId,
    userStateStep: userState?.step,
    isAdmin: isAdmin(userId),
    timestamp: Date.now()
  });

  // Implement rate limiting for all users
  const now = Date.now();
  const userRequests = userRequestCount.get(userId) || [];
  // Filter requests from the last window
  const recentRequests = userRequests.filter(time => now - time < requestLimits.windowMs);

  logger.logBot(`[ULTRA_LOG] Rate limiting check`, {
    userId: userId,
    recentRequestsCount: recentRequests.length,
    maxRequests: requestLimits.maxRequests,
    isAdmin: isAdmin(userId),
    isRateLimited: recentRequests.length >= requestLimits.maxRequests && !isAdmin(userId),
    timestamp: Date.now()
  });

  if (recentRequests.length >= requestLimits.maxRequests && !isAdmin(userId)) {
    logger.logBot(`[ULTRA_LOG] Rate limit exceeded`, {
      userId: userId,
      recentRequestsCount: recentRequests.length,
      maxRequests: requestLimits.maxRequests,
      timestamp: Date.now()
    });

    await ctx.reply('⚠️ Превышен лимит запросов. Пожалуйста, подождите немного перед отправкой новых запросов.');
    return;
  }

  // Add current request to the list
  recentRequests.push(now);
  userRequestCount.set(userId, recentRequests);

  logger.logBot(`[ULTRA_LOG] Updated request count`, {
    userId: userId,
    updatedRequestsCount: userRequests.length,
    timestamp: Date.now()
  });

  // Check if user is in balance recharge mode
  const rechargeState = rechargeStates.get(userId);
  if (rechargeState) {
    // User is in balance recharge mode, expecting amount
    const messageText = ctx.message.text.trim();

    // Check if message is a valid number
    const amount = parseFloat(messageText);

    if (!isNaN(amount) && amount > 0) {
      // Save the amount and inform user about payment details
      rechargeState.amount = amount;
      rechargeState.timestamp = Date.now();

      // Get payment requisites from environment
      const paymentRequisites = process.env.PAYMENT_REQUISITES_SBP || process.env.PAYMENT_REQUISITES_TEXT || 'Не указаны';

      await ctx.replyWithMarkdown(
        `💳 *Подтверждение пополнения*\n\n` +
        `Сумма пополнения: *${amount}* ₽\n\n` +
        `Для пополнения переведите ровно *${amount}* рублей по СБП на:\n` +
        `${paymentRequisites}\n\n` +
        `После оплаты отправьте *скриншот чека* в этот чат.\n\n` +
        `Баланс будет пополнен автоматически после проверки платежа.`
      );

      // Update state to indicate amount entered
      rechargeStates.set(userId, rechargeState);
      return; // Exit early to avoid processing as model params
    } else {
      await ctx.reply(`❌ Некорректная сумма. Пожалуйста, введите положительное число (например, 1000 для 1000 рублей).`);
      return; // Exit early to avoid processing as model params
    }
  }

  // If user is in model parameter input mode
  logger.logBot(`[ULTRA_LOG] Checking model parameter input mode`, {
    userId: userId,
    userStateExists: !!userState,
    userStateMode: userState?.mode,
    isModelParamsMode: userState?.mode === 'model_params',
    timestamp: Date.now()
  });

  if (userState && userState.mode === 'model_params') {
    // Check if this is a duplicate request (same content sent recently)
    if (userState.lastRequestTime && (now - userState.lastRequestTime) < 2000) { // 2 seconds
      // Ignore duplicate requests within 2 seconds
      return;
    }

    // Update last request time
    userState.lastRequestTime = now;
    userStates.set(userId, userState);

    try {
      let inputParams = {};
      const model = await db.getModel(userState.modelId);

      if (!model) {
        await ctx.reply('❌ Модель не найдена.');
        userStates.delete(userId); // Clear state on error
        return;
      }

      try {
        // Try to parse as JSON first
        inputParams = JSON.parse(ctx.message.text);

        // Validate that it's an object
        if (typeof inputParams !== 'object' || inputParams === null || Array.isArray(inputParams)) {
          await ctx.reply('❌ Параметры должны быть в формате JSON объекта.');
          userStates.delete(userId); // Clear state on error
          return;
        }
      } catch (e) {
        // If not JSON, treat as prompt text
        inputParams = { prompt: ctx.message.text.substring(0, 5000) }; // Limit prompt length
      }

      // Validate required fields for nano-banana-pro based on schema
      if (model.id === 'nano-banana-pro' && model.input_schema && model.input_schema.properties) {
        const requiredProps = model.input_schema.properties;

        // Validate prompt
        if (requiredProps.prompt && requiredProps.prompt.required &&
            (!inputParams.prompt || typeof inputParams.prompt !== 'string' || inputParams.prompt.trim() === '')) {
          await ctx.reply('❌ Поле "prompt" обязательно и должно быть непустой строкой.');
          userStates.delete(userId); // Clear state on error
          return;
        }

        // Validate and sanitize prompt length
        if (inputParams.prompt && typeof inputParams.prompt === 'string') {
          if (inputParams.prompt.length > 5000) {
            await ctx.reply('⚠️ Ваш промпт был обрезан до 5000 символов (максимальная длина для модели).');
            inputParams.prompt = inputParams.prompt.substring(0, 5000);
          }
        }

        // Validate aspect_ratio if provided
        if (inputParams.aspect_ratio && requiredProps.aspect_ratio && requiredProps.aspect_ratio.enum) {
          if (!requiredProps.aspect_ratio.enum.includes(inputParams.aspect_ratio)) {
            await ctx.reply(`❌ Недопустимое значение "aspect_ratio". Допустимые значения: ${requiredProps.aspect_ratio.enum.join(', ')}`);
            userStates.delete(userId); // Clear state on error
            return;
          }
        }

        // Validate resolution if provided
        if (inputParams.resolution && requiredProps.resolution && requiredProps.resolution.enum) {
          if (!requiredProps.resolution.enum.includes(inputParams.resolution)) {
            await ctx.reply(`❌ Недопустимое значение "resolution". Допустимые значения: ${requiredProps.resolution.enum.join(', ')}`);
            userStates.delete(userId); // Clear state on error
            return;
          }
        }

        // Validate output_format if provided
        if (inputParams.output_format && requiredProps.output_format && requiredProps.output_format.enum) {
          if (!requiredProps.output_format.enum.includes(inputParams.output_format)) {
            await ctx.reply(`❌ Недопустимое значение "output_format". Допустимые значения: ${requiredProps.output_format.enum.join(', ')}`);
            userStates.delete(userId); // Clear state on error
            return;
          }
        }
      }
      // Validate required fields for z-image based on schema
      else if (model.id === 'z-image' && model.input_schema && model.input_schema.properties) {
        const requiredProps = model.input_schema.properties;

        // Validate prompt
        if (requiredProps.prompt &&
            (!inputParams.prompt || typeof inputParams.prompt !== 'string' || inputParams.prompt.trim() === '')) {
          await ctx.reply('❌ Поле "prompt" обязательно и должно быть непустой строкой.');
          userStates.delete(userId); // Clear state on error
          return;
        }

        // Validate and sanitize prompt length
        if (inputParams.prompt && typeof inputParams.prompt === 'string') {
          if (inputParams.prompt.length > 1000) {
            await ctx.reply('⚠️ Ваш промпт был обрезан до 1000 символов (максимальная длина для модели z-image).');
            inputParams.prompt = inputParams.prompt.substring(0, 1000);
          }
        }

        // Validate aspect_ratio if provided
        if (inputParams.aspect_ratio && requiredProps.aspect_ratio) {
          const validRatios = requiredProps.aspect_ratio.enum || ['1:1', '4:3', '3:4', '16:9', '9:16'];
          if (!validRatios.includes(inputParams.aspect_ratio)) {
            await ctx.reply(`❌ Недопустимое значение "aspect_ratio". Допустимые значения: ${validRatios.join(', ')}`);
            userStates.delete(userId); // Clear state on error
            return;
          }
        }

        // Set default aspect_ratio if not provided (z-image requires this field)
        if (!inputParams.aspect_ratio && requiredProps.aspect_ratio && requiredProps.aspect_ratio.default) {
          inputParams.aspect_ratio = requiredProps.aspect_ratio.default;
        } else if (!inputParams.aspect_ratio) {
          // If no default is provided in schema, use 1:1 as standard
          inputParams.aspect_ratio = '1:1';
        }
      }
      // Validate required fields for seedream/4.5 based on schema
      else if (model.id === 'seedream-4.5' && model.input_schema && model.input_schema.properties) {
        const requiredProps = model.input_schema.properties;

        // Validate prompt
        if (requiredProps.prompt &&
            (!inputParams.prompt || typeof inputParams.prompt !== 'string' || inputParams.prompt.trim() === '')) {
          await ctx.reply('❌ Поле "prompt" обязательно и должно быть непустой строкой.');
          userStates.delete(userId); // Clear state on error
          return;
        }

        // Validate and sanitize prompt length for seedream
        if (inputParams.prompt && typeof inputParams.prompt === 'string') {
          if (inputParams.prompt.length > 3000) {
            await ctx.reply('⚠️ Ваш промпт был обрезан до 3000 символов (максимальная длина для модели Seedream 4.5).');
            inputParams.prompt = inputParams.prompt.substring(0, 3000);
          }
        }

        // Validate aspect_ratio if provided
        if (inputParams.aspect_ratio && requiredProps.aspect_ratio) {
          const validRatios = requiredProps.aspect_ratio.enum || ['1:1', '4:3', '3:4', '16:9', '9:16'];
          if (!validRatios.includes(inputParams.aspect_ratio)) {
            await ctx.reply(`❌ Недопустимое значение "aspect_ratio". Допустимые значения: ${validRatios.join(', ')}`);
            userStates.delete(userId); // Clear state on error
            return;
          }
        }

        // Validate quality if provided
        if (inputParams.quality && requiredProps.quality) {
          const validQualities = requiredProps.quality.enum || ['basic', 'high'];
          if (!validQualities.includes(inputParams.quality)) {
            await ctx.reply(`❌ Недопустимое значение "quality". Допустимые значения: ${validQualities.join(', ')}`);
            userStates.delete(userId); // Clear state on error
            return;
          }
        }

        // Set defaults for required fields that weren't provided
        if (!inputParams.aspect_ratio && requiredProps.aspect_ratio && requiredProps.aspect_ratio.default) {
          inputParams.aspect_ratio = requiredProps.aspect_ratio.default;
        } else if (!inputParams.aspect_ratio) {
          // If no default is provided in schema, use 1:1 as standard
          inputParams.aspect_ratio = '1:1';
        }

        if (!inputParams.quality && requiredProps.quality && requiredProps.quality.default) {
          inputParams.quality = requiredProps.quality.default;
        } else if (!inputParams.quality) {
          // If no default is provided in schema, use basic as standard
          inputParams.quality = 'basic';
        }
      }

      // Get user and check if admin (for free generation)
      const user = await db.getUser(userId);
      if (!user) {
        await ctx.reply('❌ Пользователь не найден.');
        userStates.delete(userId); // Clear state on error
        return;
      }

      const isAdminUser = isAdmin(userId);

      // Calculate price based on model and resolution (only for non-admin users)
      let price = 0; // Default to 0 for admin

      if (!isAdminUser) {
        price = calculatePrice(model.pricing.credits);

        // For nano-banana-pro, price depends on resolution
        if (model.id === 'nano-banana-pro') {
          // Default to 1K/2K price (18 credits -> calculatePrice)
          // If resolution is 4K, price should be for 24 credits
          if (inputParams.resolution === '4K') {
            price = calculatePrice(24); // 24 credits for 4K
          } else {
            price = calculatePrice(18); // 18 credits for 1K/2K
          }
        }

        if (user.balance < price) {
          await ctx.reply(`❌ Недостаточно средств. Требуется: ${formatPriceSafe(price)}`);
          userStates.delete(userId); // Clear state on error
          return;
        }
      } else {
        // Admin gets free generation
        price = 0;
      }

      // Provide feedback about the generation that's about to happen
      let generationInfo = `🖼️ Генерация изображения начата\n`;
      generationInfo += `📝 Промпт: ${escapeMarkdown(inputParams.prompt ? inputParams.prompt.substring(0, 50) + (inputParams.prompt.length > 50 ? '...' : '') : 'не указан')}\n`;

      if (inputParams.resolution) {
        generationInfo += `📏 Разрешение: ${escapeMarkdown(inputParams.resolution)}\n`;
      }
      if (inputParams.aspect_ratio) {
        generationInfo += `📐 Соотношение: ${escapeMarkdown(inputParams.aspect_ratio)}\n`;
      }
      if (inputParams.output_format) {
        generationInfo += `🖼️ Формат: ${escapeMarkdown(inputParams.output_format)}\n`;
      }

      if (!isAdminUser) {
        generationInfo += `💳 Спишется: ${formatPriceSafe(price)}\n`;
      } else {
        generationInfo += `👑 Для администраторов: бесплатно\n`;
      }

      await ctx.reply(generationInfo);

      // Prepare input parameters for API based on model type to ensure compatibility
      logger.logBot(`[ULTRA_LOG] Before prepareApiInputParams`, {
        userId: userId,
        modelId: model.id,
        modelType: model.modelType,
        originalInputParams: inputParams,
        originalInputParamsKeys: Object.keys(inputParams || {}),
        originalInputParamsTypes: Object.keys(inputParams || {}).map(key => typeof inputParams[key])
      });

      const apiInputParams = prepareApiInputParams(model.modelType, inputParams);

      logger.logBot(`[ULTRA_LOG] After prepareApiInputParams`, {
        userId: userId,
        modelId: model.id,
        modelType: model.modelType,
        processedApiInputParams: apiInputParams,
        processedInputParamsKeys: Object.keys(apiInputParams || {}),
        processedInputParamsTypes: Object.keys(apiInputParams || {}).map(key => typeof apiInputParams[key])
      });

      // Validate input parameters before creating task
      if (!model.modelType || typeof model.modelType !== 'string') {
        logger.logError('KIE_API', 'Invalid model type provided', {
          userId: userId,
          modelId: model.id,
          modelType: model.modelType,
          modelTypeType: typeof model.modelType
        });
        await ctx.reply('❌ Некорректный тип модели. Пожалуйста, выберите другую модель.');
        userStates.delete(userId); // Clear state on error
        return;
      }

      // Create task via KIE API
      await ctx.reply('🔄 Создаю задачу...');

      logger.logBot(`[ULTRA_LOG] About to call kieApi.createTask`, {
        userId: userId,
        modelId: model.id,
        modelType: model.modelType,
        apiInputParams: apiInputParams,
        apiInputParamsKeys: Object.keys(apiInputParams || {}),
        callingTimestamp: Date.now()
      });

      let taskResult;
      try {
        // Additional validation before API call
        if (!apiInputParams || typeof apiInputParams !== 'object') {
          logger.logError('KIE_API', 'Invalid input parameters provided', {
            userId: userId,
            modelId: model.id,
            modelType: model.modelType,
            apiInputParams: apiInputParams,
            apiInputParamsType: typeof apiInputParams
          });
          await ctx.reply('❌ Некорректные параметры запроса. Пожалуйста, проверьте введенные данные.');
          userStates.delete(userId); // Clear state on error
          return;
        }

        // Additional validation for specific model requirements
        if (model.modelType && (model.modelType.includes('flux-2') || model.modelType.includes('sora') || model.modelType.includes('bytedance'))) {
          // For these models, we typically need a prompt
          if (!apiInputParams.prompt || typeof apiInputParams.prompt !== 'string' || apiInputParams.prompt.trim() === '') {
            // Allow empty prompt for some specific cases but warn
            logger.logBot(`[VALIDATION] Model ${model.modelType} called without prompt`, {
              userId: userId,
              modelType: model.modelType,
              hasPrompt: !!apiInputParams.prompt,
              promptType: typeof apiInputParams.prompt,
              promptValue: apiInputParams.prompt
            });
          }
        }

        taskResult = await kieApi.createTask(userId, model.modelType, apiInputParams);

        logger.logBot(`[ULTRA_LOG] Successfully created task`, {
          userId: userId,
          modelId: model.id,
          modelType: model.modelType,
          taskResult: taskResult,
          taskResultId: taskResult.id,
          taskResultKeys: Object.keys(taskResult || {}),
          completedTimestamp: Date.now()
        });
      } catch (apiError) {
        // Detailed error logging for debugging
        const errorId = 'TASK_' + Date.now();
        logger.logError('KIE_API', `Error creating task via KIE API for user ${userId}`, {
          errorId: errorId,
          userId: userId,
          modelId: model.id,
          modelType: model.modelType,
          inputParams: inputParams,
          preparedApiInputParams: apiInputParams, // Log the prepared parameters that were sent to API
          errorName: apiError.name,
          errorMessage: apiError.message,
          errorCode: apiError.code, // Include error code if available
          errorResponse: apiError.response?.data, // Include response data if available
          errorStatus: apiError.response?.status, // Include status code if available
          errorHeaders: apiError.response?.headers, // Include response headers for debugging
          stack: apiError.stack,
          isAdmin: isAdmin(userId),
          apiKeyPresent: !!process.env.KIE_API_KEY, // Check if API key is present
          dryRunMode: process.env.DRY_RUN === '1', // Check current mode
          userBalance: user?.balance // Include user balance for context
        });

        // Send user-friendly message with error code
        if (apiError.code === 'DUPLICATE_REQUEST') {
          await ctx.reply(`⏱️ Пожалуйста, подождите перед отправкой нового запроса.`);
        } else {
          // Provide more specific error message based on error type
          let userErrorMessage = `❌ Ошибка при создании задачи. Пожалуйста, проверьте параметры и попробуйте снова. (код ошибки: ${errorId})`;

          // Add specific error details for common issues
          if (apiError.response?.status === 401) {
            userErrorMessage = `❌ Ошибка аутентификации. Пожалуйста, проверьте API-ключ. (код ошибки: ${errorId})`;
          } else if (apiError.response?.status === 403) {
            userErrorMessage = `❌ Доступ запрещен. Пожалуйста, проверьте права доступа API-ключа. (код ошибки: ${errorId})`;
          } else if (apiError.response?.status === 429) {
            userErrorMessage = `❌ Слишком много запросов. Пожалуйста, подождите немного. (код ошибки: ${errorId})`;
          } else if (apiError.response?.status >= 500) {
            userErrorMessage = `❌ Внутренняя ошибка сервера. Пожалуйста, повторите попытку позже. (код ошибки: ${errorId})`;
          } else if (apiError.response?.status === 422) {
            userErrorMessage = `❌ Некорректные параметры запроса. Проверьте формат и значения параметров. (код ошибки: ${errorId})`;
          } else if (apiError.response?.status === 400) {
            userErrorMessage = `❌ Неверный запрос. Проверьте параметры и попробуйте снова. (код ошибки: ${errorId})`;
          }

          await ctx.reply(userErrorMessage);
        }
        userStates.delete(userId); // Clear state on error
        return;
      }

      // Validate that taskResult has an ID before proceeding
      if (!taskResult || !taskResult.id) {
        const errorId = 'TASK_ID_MISSING_' + Date.now();
        logger.logError('KIE_API', `Task creation response missing ID`, {
          errorId: errorId,
          userId: userId,
          modelId: model.id,
          modelType: model.modelType,
          taskResult: taskResult,
          taskResultType: typeof taskResult
        });

        await ctx.reply(`❌ Ошибка: задача создана без идентификатора. Пожалуйста, попробуйте снова. (код ошибки: ${errorId})`);
        userStates.delete(userId); // Clear state on error
        return;
      }

      // Do NOT deduct price immediately - only deduct when task completes successfully
      // Only deduct price from user balance if not admin (for API call costs we still want to handle this later)
      // Initial approach: Create task with 'pending_payment' status

      // Save task to database with initial status and no payment deducted
      const task = {
        id: taskResult.id,
        userId: userId,
        modelId: model.id,
        modelType: model.modelType,
        inputParams: inputParams,
        createdAt: new Date().toISOString(),
        status: 'created',
        price: price,
        priceDeducted: false // Flag to track if price has been deducted
      };

      await db.saveTask(task);

      // Update stats
      systemStats.totalTasksCreated++;
      systemStats.activeUsers.add(userId);

      await ctx.reply(`✅ Задача создана!\nID задачи: ${taskResult.id}\nОжидайте результат...`);

      // Clear user state
      userStates.delete(userId);

      // Store chatId for use in async callback
      const chatId = ctx.chat.id;

      // Check task status and send result when ready (in a background process)
      // Enhanced logging for debugging
      // Only schedule task status check if we have a valid task ID (not an error ID)
      if (taskResult.id && !taskResult.id.startsWith('error_')) {
        setTimeout(async () => {
          logger.logBot(`[ULTRA_LOG] Starting task result checking timeout`, {
            userId: userId,
            taskId: taskResult.id,
            modelType: model.modelType,
            scheduledTime: new Date().toISOString(),
            timeoutDuration: 30000
          });

          try {
          logger.logBot(`[ULTRA_LOG] Before calling kieApi.getTaskInfo`, {
            userId: userId,
            taskId: taskResult.id,
            modelType: model.modelType,
            checkTime: new Date().toISOString(),
            kieApiExists: !!kieApi,
            kieApiGetTypeTaskInfo: typeof kieApi.getTaskInfo
          });

          logger.logBot(`Checking task status for taskId: ${taskResult.id}`, {
            userId: userId,
            taskId: taskResult.id,
            modelType: model.modelType,
            checkTime: new Date().toISOString()
          });

          let taskInfo = null;
          try {
            taskInfo = await kieApi.getTaskInfo(userId, taskResult.id);

            // Validate taskInfo structure
            if (!taskInfo || typeof taskInfo !== 'object') {
              logger.logError('TASK_INFO_VALIDATION', `Invalid taskInfo structure for taskId: ${taskResult.id}`, {
                userId: userId,
                taskId: taskResult.id,
                taskInfoType: typeof taskInfo,
                taskInfo: taskInfo,
                modelType: model.modelType
              });

              await bot.telegram.sendMessage(chatId, `⚠️ Некорректная структура данных задачи. Попробуйте проверить позже с помощью /my_tasks`);
              return;
            }
          } catch (infoError) {
            // More specific error handling for task info request
            const errorId = 'INFO_' + Date.now();
            logger.logError('TASK_INFO', `Error getting task info for taskId ${taskResult.id}`, {
              errorId: errorId,
              taskId: taskResult.id,
              userId: userId,
              modelType: model.modelType,
              errorName: infoError.name,
              errorMessage: infoError.message,
              errorStatus: infoError.response?.status,
              errorResponse: infoError.response?.data,
              stack: infoError.stack
            });

            // Provide more specific error message based on error type
            let userErrorMessage = `⚠️ Не удалось получить статус задачи. Попробуйте проверить позже с помощью /my_tasks (код ошибки: ${errorId})`;

            if (infoError.response?.status === 401) {
              userErrorMessage = `❌ Ошибка аутентификации при получении статуса задачи (код ошибки: ${errorId})`;
            } else if (infoError.response?.status === 403) {
              userErrorMessage = `❌ Доступ запрещен при получении статуса задачи (код ошибки: ${errorId})`;
            } else if (infoError.response?.status === 429) {
              userErrorMessage = `⏳ Слишком много запросов, подождите немного (код ошибки: ${errorId})`;
            } else if (infoError.response?.status >= 500) {
              userErrorMessage = `🔧 Внутренняя ошибка сервера, повторите позже (код ошибки: ${errorId})`;
            }

            await bot.telegram.sendMessage(chatId, userErrorMessage);
            return;
          }

          logger.logBot(`[ULTRA_LOG] Received taskInfo from API`, {
            userId: userId,
            taskId: taskResult.id,
            taskInfoType: typeof taskInfo,
            taskInfoKeys: Object.keys(taskInfo || {}),
            taskInfo: taskInfo,
            state: taskInfo?.state
          });

          logger.logBot(`Task status received`, {
            userId: userId,
            taskId: taskResult.id,
            taskState: taskInfo?.state,
            taskInfoKeys: Object.keys(taskInfo || {}),
            hasResultJson: !!taskInfo?.resultJson
          });

          // Validate taskInfo structure to prevent errors
          if (!taskInfo || typeof taskInfo !== 'object') {
            logger.logError('TASK_VALIDATION', `Invalid taskInfo structure for taskId: ${taskResult.id}`, {
              userId: userId,
              taskId: taskResult.id,
              taskInfoType: typeof taskInfo,
              taskInfo: taskInfo
            });
            return;
          }

          logger.logBot(`[ULTRA_LOG] Processing task state`, {
            userId: userId,
            taskId: taskResult.id,
            taskState: taskInfo?.state,
            isSuccess: taskInfo?.state === 'success',
            expectedState: 'success',
            actualState: taskInfo?.state
          });

          // Additional validation to ensure taskInfo has required properties
          const requiredProps = ['state'];
          const missingProps = requiredProps.filter(prop => !(prop in taskInfo));

          if (missingProps.length > 0) {
            logger.logError('TASK_STRUCTURE', `Missing required properties in taskInfo for taskId: ${taskResult.id}`, {
              userId: userId,
              taskId: taskResult.id,
              missingProperties: missingProps,
              taskInfo: taskInfo
            });
            return;
          }

          if (taskInfo.state === 'success') {
            logger.logBot(`[ULTRA_LOG] Task is in success state, processing result`, {
              userId: userId,
              taskId: taskResult.id,
              resultJsonExists: !!taskInfo.resultJson,
              resultJsonType: typeof taskInfo.resultJson,
              rawResultJson: taskInfo.resultJson
            });

            logger.logBot(`Task completed successfully`, {
              userId: userId,
              taskId: taskResult.id,
              resultJson: taskInfo.resultJson
            });

            // Send the result to the user
            if (taskInfo.resultJson) {
              logger.logBot(`[ULTRA_LOG] Processing result JSON`, {
                userId: userId,
                taskId: taskResult.id,
                resultJson: taskInfo.resultJson,
                resultJsonLength: taskInfo.resultJson?.length
              });

              let resultData;
              try {
                logger.logBot(`[ULTRA_LOG] About to parse result JSON`, {
                  userId: userId,
                  taskId: taskResult.id,
                  jsonToParse: taskInfo.resultJson,
                  jsonType: typeof taskInfo.resultJson
                });

                resultData = JSON.parse(taskInfo.resultJson);

                logger.logBot(`[ULTRA_LOG] Successfully parsed result JSON`, {
                  userId: userId,
                  taskId: taskResult.id,
                  resultDataType: typeof resultData,
                  resultDataKeys: Object.keys(resultData),
                  hasResultUrls: !!resultData.resultUrls,
                  resultUrlsCount: Array.isArray(resultData.resultUrls) ? resultData.resultUrls.length : 0,
                  resultUrls: resultData.resultUrls,
                  parsedResultData: resultData
                });

                logger.logBot(`Parsed result data`, {
                  userId: userId,
                  taskId: taskResult.id,
                  resultDataKeys: Object.keys(resultData),
                  hasResultUrls: !!resultData.resultUrls,
                  resultUrlsCount: resultData.resultUrls?.length
                });
              } catch (parseError) {
                logger.logBot(`[ULTRA_LOG] Failed to parse result JSON`, {
                  userId: userId,
                  taskId: taskResult.id,
                  resultJson: taskInfo.resultJson,
                  errorName: parseError.name,
                  errorMessage: parseError.message,
                  errorStack: parseError.stack
                });

                const errorId = 'PARSE_' + Date.now();
                logger.logError('RESULT_PARSE', `Failed to parse result JSON for task ${taskResult.id}`, {
                  errorId: errorId,
                  taskId: taskResult.id,
                  userId: userId,
                  resultJson: taskInfo.resultJson,
                  errorName: parseError.name,
                  errorMessage: parseError.message,
                  stack: parseError.stack
                });

                await bot.telegram.sendMessage(chatId, `⚠️ Не удалось обработать результат задачи. Пожалуйста, сообщите администратору код ошибки: ${errorId}`);
                return;
              }

              logger.logBot(`[ULTRA_LOG] Checking for result URLs`, {
                userId: userId,
                taskId: taskResult.id,
                hasResultUrls: !!resultData.resultUrls,
                resultUrlsType: typeof resultData.resultUrls,
                resultUrlsIsArray: Array.isArray(resultData.resultUrls),
                resultUrls: resultData.resultUrls
              });

              if (resultData.resultUrls && resultData.resultUrls.length > 0) {
                logger.logBot(`[ULTRA_LOG] Found ${resultData.resultUrls.length} result URLs, preparing to send`, {
                  userId: userId,
                  taskId: taskResult.id,
                  imageUrls: resultData.resultUrls,
                  urlsCount: resultData.resultUrls.length
                });

                logger.logBot(`Sending ${resultData.resultUrls.length} result images to user`, {
                  userId: userId,
                  taskId: taskResult.id,
                  imageUrls: resultData.resultUrls
                });

                // Send photo to user with validation
                for (let i = 0; i < resultData.resultUrls.length; i++) {
                  const imageUrl = resultData.resultUrls[i];

                  logger.logBot(`[ULTRA_LOG] Processing image URL ${i + 1}/${resultData.resultUrls.length}`, {
                    userId: userId,
                    taskId: taskResult.id,
                    currentIndex: i,
                    imageUrl: imageUrl,
                    imageUrlType: typeof imageUrl,
                    imageUrlIsValidString: typeof imageUrl === 'string',
                    imageUrlHasHttp: typeof imageUrl === 'string' && imageUrl.startsWith('http')
                  });

                  // Validate image URL
                  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
                    logger.logBot(`[ULTRA_LOG] Invalid image URL detected`, {
                      userId: userId,
                      taskId: taskResult.id,
                      invalidImageUrl: imageUrl,
                      invalidImageUrlType: typeof imageUrl,
                      invalidUrlReasons: [
                        !imageUrl ? 'URL is empty/null/undefined' : null,
                        typeof imageUrl !== 'string' ? 'URL is not a string' : null,
                        typeof imageUrl === 'string' && !imageUrl.startsWith('http') ? 'URL does not start with http' : null
                      ].filter(Boolean).join(', ')
                    });

                    const errorId = 'IMAGE_URL_' + Date.now();
                    logger.logError('IMAGE_URL', `Invalid image URL received from API`, {
                      errorId: errorId,
                      taskId: taskResult.id,
                      userId: userId,
                      imageUrl: imageUrl,
                      rawResult: taskInfo.resultJson
                    });
                    continue; // Skip invalid URLs
                  }

                  logger.logBot(`[ULTRA_LOG] Valid image URL, attempting to send`, {
                    userId: userId,
                    taskId: taskResult.id,
                    imageUrl: imageUrl,
                    currentIndex: i,
                    totalImages: resultData.resultUrls.length
                  });

                  try {
                    // Check if URL is accessible before sending
                    logger.logBot(`Sending image to user`, {
                      userId: userId,
                      imageUrl: imageUrl
                    });

                    await bot.telegram.sendPhoto(chatId, { url: imageUrl });
                    logger.logBot(`[ULTRA_LOG] Successfully sent image via sendPhoto`, {
                      userId: userId,
                      taskId: taskResult.id,
                      imageUrl: imageUrl,
                      currentIndex: i,
                      totalImages: resultData.resultUrls.length
                    });

                    logger.logBot(`Successfully sent image to user`, {
                      userId: userId,
                      taskId: taskResult.id,
                      imageUrl: imageUrl
                    });
                  } catch (sendError) {
                    logger.logBot(`[ULTRA_LOG] sendPhoto failed, trying sendDocument`, {
                      userId: userId,
                      taskId: taskResult.id,
                      imageUrl: imageUrl,
                      errorName: sendError.name,
                      errorMessage: sendError.message,
                      currentIndex: i,
                      totalImages: resultData.resultUrls.length
                    });

                    const errorId = 'SEND_' + Date.now();
                    logger.logError('PHOTO_SEND', `Failed to send image to user ${userId}`, {
                      errorId: errorId,
                      taskId: taskResult.id,
                      userId: userId,
                      imageUrl: imageUrl,
                      errorName: sendError.name,
                      errorMessage: sendError.message,
                      stack: sendError.stack
                    });

                    // Try to send as document if photo fails
                    try {
                      logger.logBot(`[ULTRA_LOG] Attempting to send image as document`, {
                        userId: userId,
                        taskId: taskResult.id,
                        imageUrl: imageUrl
                      });

                      await bot.telegram.sendDocument(chatId, { url: imageUrl });
                      logger.logBot(`[ULTRA_LOG] Successfully sent image as document`, {
                        userId: userId,
                        taskId: taskResult.id,
                        imageUrl: imageUrl,
                        currentIndex: i,
                        totalImages: resultData.resultUrls.length
                      });

                      logger.logBot(`Successfully sent image as document to user`, {
                        userId: userId,
                        taskId: taskResult.id,
                        imageUrl: imageUrl
                      });
                    } catch (docError) {
                      logger.logBot(`[ULTRA_LOG] sendDocument also failed`, {
                        userId: userId,
                        taskId: taskResult.id,
                        imageUrl: imageUrl,
                        docErrorName: docError.name,
                        docErrorMessage: docError.message,
                        currentIndex: i,
                        totalImages: resultData.resultUrls.length
                      });

                      const docErrorId = 'DOC_' + Date.now();
                      logger.logError('DOC_SEND', `Failed to send image as document to user ${userId}`, {
                        errorId: docErrorId,
                        taskId: taskResult.id,
                        userId: userId,
                        imageUrl: imageUrl,
                        errorName: docError.message,
                        errorMessage: docError.message,
                        stack: docError.stack
                      });

                      await bot.telegram.sendMessage(chatId, `🖼️ Результат готов: ${escapeMarkdown(imageUrl)} (ошибка отправки: ${docErrorId})`);
                    }
                  }
                }

                logger.logBot(`[ULTRA_LOG] Finished processing all result images`, {
                  userId: userId,
                  taskId: taskResult.id,
                  totalImagesProcessed: resultData.resultUrls.length,
                  completedTime: new Date().toISOString()
                });

                // NOW deduct price from user balance after successful generation
                // Only for non-admin users
                const userIsAdmin = isAdmin(userId);
                if (!userIsAdmin) {
                  // Get current user balance to make sure we're using the right amount
                  const currentUser = await db.getUser(userId);
                  if (currentUser && currentUser.balance >= price) {
                    await db.updateUser(userId, {
                      balance: currentUser.balance - price
                    });

                    // Update task status in database
                    await db.updateTask(taskResult.id, {
                      status: 'completed',
                      completedAt: new Date().toISOString(),
                      priceDeducted: true
                    });

                    // Update stats
                    systemStats.totalTasksCompleted++;
                    systemStats.totalRevenue += price;

                    // Send confirmation message about deduction
                    await bot.telegram.sendMessage(chatId, `💰 С вашего баланса списано: ${formatPriceSafe(price)}`);
                  } else {
                    // Handle case where user doesn't have enough balance after task completion
                    // (This shouldn't happen if initial check passed, but just in case)
                    const errorId = 'BALANCE_' + Date.now();
                    logger.logError('BALANCE', `Insufficient balance after task completion`, {
                      errorId: errorId,
                      taskId: taskResult.id,
                      userId: userId,
                      required: price,
                      available: currentUser?.balance || 0
                    });

                    await bot.telegram.sendMessage(chatId, `⚠️ Ошибка списания средств. Пожалуйста, обратитесь к администратору. (код: ${errorId})`);
                    // Mark task as completed without payment deduction
                    await db.updateTask(taskResult.id, {
                      status: 'completed_no_payment',
                      completedAt: new Date().toISOString(),
                      priceDeducted: false,
                      errorId: errorId
                    });
                  }
                } else {
                  // Update task status in database for admin (no deduction)
                  await db.updateTask(taskResult.id, {
                    status: 'completed',
                    completedAt: new Date().toISOString()
                  });

                  // Update stats for admin (completed but no revenue)
                  systemStats.totalTasksCompleted++;
                }
              } else {
                await bot.telegram.sendMessage(chatId, '⚠️ Результат задачи не содержит изображений.');
              }
            }
          } else if (taskInfo && (taskInfo.state === 'failed' || taskInfo.state === 'fail')) {
            const errorId = 'TASK_FAIL_' + Date.now();
            logger.logError('TASK_FAILED', `Task completed with failure state`, {
              errorId: errorId,
              taskId: taskResult.id,
              userId: userId,
              failCode: taskInfo.failCode,
              failMsg: taskInfo.failMsg,
              state: taskInfo.state
            });

            await bot.telegram.sendMessage(chatId, `❌ Задача завершена с ошибкой: ${taskInfo.failMsg || 'Неизвестная ошибка'}. (код ошибки: ${errorId})`);
            // Update task status in database - no payment deduction for failed tasks
            await db.updateTask(taskResult.id, {
              status: 'failed',
              failMsg: taskInfo.failMsg,
              failCode: taskInfo.failCode,
              errorId: errorId,
              priceDeducted: false  // Ensure no payment was deducted
            });

            // Update stats for failed task
            systemStats.totalTasksFailed++;
          } else if (taskInfo) {
            await bot.telegram.sendMessage(chatId, `ℹ️ Статус задачи: ${taskInfo.state || 'unknown'}`);
          }
        } catch (checkError) {
          const errorId = 'CHECK_' + Date.now();
          logger.logError('TASK_CHECK', `Error checking task status for task ${taskResult.id}`, {
            errorId: errorId,
            taskId: taskResult.id,
            userId: userId,
            errorName: checkError.name,
            errorMessage: checkError.message,
            stack: checkError.stack
          });

          await bot.telegram.sendMessage(chatId, `⚠️ Не удалось получить статус задачи. Попробуйте проверить позже с помощью /my_tasks (код ошибки: ${errorId})`);
        }
      }, 30000); // Check after 30 seconds
    } else {
      // If we have an error ID instead of valid task ID, inform user
      await ctx.reply(`❌ Не удалось создать задачу из-за ошибки API. Пожалуйста, попробуйте снова.`);
      logger.logBot(`[INFO] Task creation failed - received error ID instead of valid task ID`, {
        userId: userId,
        errorTaskId: taskResult.id,
        modelId: model.id
      });
    }

    } catch (error) {
      const errorId = 'PARAM_' + Date.now();
      logger.logError('PARAM_PROCESSING', `Error processing model parameters from user ${userId}`, {
        errorId: errorId,
        userId: userId,
        modelId: userState.modelId,
        inputText: ctx.message?.text || 'unknown',
        errorName: error.name,
        errorMessage: error.message,
        stack: error.stack
      });

      await ctx.reply(`❌ Ошибка обработки параметров. Пожалуйста, попробуйте снова. (код ошибки: ${errorId})`);
      userStates.delete(userId); // Clear state on error in catch block too
    }
  }
});

// Callback query handler
bot.on('callback_query', async (ctx) => {
  const userId = ctx.from.id;
  const callbackData = ctx.callbackQuery.data;

  // Implement rate limiting for callbacks too
  const now = Date.now();
  const userRequests = userRequestCount.get(userId) || [];
  // Filter requests from the last window
  const recentRequests = userRequests.filter(time => now - time < requestLimits.windowMs);

  // Allow more callback requests but still limit excessive usage
  if (recentRequests.length >= requestLimits.maxRequests * 2 && !isAdmin(userId)) {
    await ctx.answerCbQuery('⚠️ Слишком много запросов. Пожалуйста, подождите немного.', { show_alert: true });
    return;
  }

  // Add current request to the list
  recentRequests.push(now);
  userRequestCount.set(userId, recentRequests);

  logger.logBot(`Callback query from ${userId}: ${callbackData}`);

  try {
    if (callbackData === 'main_menu') {
      // Clear user state when going back to main menu
      userStates.delete(userId);

      let user = await db.getUser(userId);
      const balance = user ? formatPrice(user.balance) : '0.00 ₽';

      await ctx.editMessageText(
        `💰 *Ваш баланс:* ${escapeMarkdown(balance)}\n\n` +
        `🎉 *Добро пожаловать в KIE AI BOT!*\n\n` +
        `💥 *Все нейросети в одном боте по лучшим ценам!*\n\n` +
        `✨ *Текущий статус:* ${isAdmin(userId) ? '👑 Администратор (бесплатная генерация)' : '👤 Пользователь'}\n\n` +
        `Выберите действие:`,
        {
          parse_mode: 'Markdown',
          reply_markup: mainMenuInlineKeyboard(userId).reply_markup
        }
      );
    }
    else if (callbackData === 'select_model') {
      // Show all available models to user
      const models = await db.getModels();
      const enabledModels = models.filter(m => m.enabled);

      if (enabledModels.length === 0) {
        await ctx.editMessageText(
          '❌ В данный момент нет доступных моделей.',
          {
            reply_markup: mainMenuInlineKeyboard(userId).reply_markup
          }
        );
        return;
      }

      // Create inline keyboard with all models
      const modelKeyboard = [];
      for (const model of enabledModels) {
        modelKeyboard.push([{ text: `${formatModelDisplayName(model)}`, callback_data: `model_${model.id}` }]);
      }

      modelKeyboard.push([{ text: '◀️ Назад', callback_data: 'main_menu' }]);

      await ctx.editMessageText(
        `🧠 *Доступные модели:*\n\n` +
        `Выберите модель для генерации:`,
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard(modelKeyboard).reply_markup
        }
      );
    }
    else if (callbackData.startsWith('model_') && !callbackData.includes('_cancel')) {
      // Handle model selection
      const modelId = callbackData.substring(6); // Remove 'model_' prefix
      const model = await db.getModel(modelId);

      if (!model) {
        await ctx.answerCbQuery('❌ Модель не найдена.', { show_alert: true });
        return;
      }

      // Format model info based on user role
      const isAdminUser = isAdmin(userId);
      let response = formatModelInfo(model, isAdminUser);

      // Create keyboard with options to use model or go back
      const modelKeyboard = [
        [{ text: '🚀 Использовать модель', callback_data: `use_model_${modelId}` }],
        [{ text: '◀️ Назад', callback_data: 'select_model' }]
      ];

      await ctx.editMessageText(response, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(modelKeyboard).reply_markup
      });
    }
    else if (callbackData === 'model_z-image') {
      // Show z-image model directly
      const model = await db.getModel('z-image');
      if (!model) {
        await ctx.answerCbQuery('❌ Модель Z-Image не найдена.', { show_alert: true });
        return;
      }

      // Format model info based on user role
      const isAdminUser = isAdmin(userId);
      const response = formatModelInfo(model, isAdminUser);

      // Create keyboard with options to use model or go back
      const modelKeyboard = [
        [{ text: '🚀 Использовать модель', callback_data: 'use_model_z-image' }],
        [{ text: '◀️ Назад', callback_data: 'main_menu' }]
      ];

      await ctx.editMessageText(response, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(modelKeyboard).reply_markup
      });
    }
    else if (callbackData === 'model_seedream-4.5') {
      // Show seedream-4.5 model directly
      const model = await db.getModel('seedream-4.5');
      if (!model) {
        await ctx.answerCbQuery('❌ Модель Seedream 4.5 не найдена.', { show_alert: true });
        return;
      }

      // Format model info based on user role
      const isAdminUser = isAdmin(userId);
      const response = formatModelInfo(model, isAdminUser);

      // Create keyboard with options to use model or go back
      const modelKeyboard = [
        [{ text: '🚀 Использовать модель', callback_data: 'use_model_seedream-4.5' }],
        [{ text: '◀️ Назад', callback_data: 'main_menu' }]
      ];

      await ctx.editMessageText(response, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(modelKeyboard).reply_markup
      });
    }
    else if (callbackData.startsWith('model_')) {
      const modelId = callbackData.substring(6); // Remove 'model_' prefix
      const model = await db.getModel(modelId);

      if (!model) {
        await ctx.answerCbQuery('❌ Модель не найдена.', { show_alert: true });
        return;
      }

      // Format model info based on user role
      const isAdminUser = isAdmin(userId);
      let response = formatModelInfo(model, isAdminUser);

      // Create keyboard with options to use model or go back
      // Map Russian category names to English codes for callback
      const categoryCodeMap = {
        'Фото': 'photo',
        'Видео': 'video',
        'Аудио': 'audio',
        'Инструменты': 'tools'
      };

      const categoryCode = categoryCodeMap[model.category] || model.category.toLowerCase();

      const modelKeyboard = [
        [{ text: '🚀 Использовать модель', callback_data: `use_model_${modelId}` }],
        [{ text: '◀️ Назад', callback_data: `category_${categoryCode}` }]
      ];

      await ctx.editMessageText(response, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(modelKeyboard).reply_markup
      });
    }
    else if (callbackData.startsWith('use_model_')) {
      const modelId = callbackData.substring(10); // Remove 'use_model_' prefix
      const model = await db.getModel(modelId);

      if (!model) {
        await ctx.answerCbQuery('❌ Модель не найдена.', { show_alert: true });
        return;
      }

      // Check user balance
      const user = await db.getUser(userId);
      if (!user) {
        await ctx.answerCbQuery('❌ Пользователь не найден.', { show_alert: true });
        return;
      }

      const isAdminUser = isAdmin(userId);

      // For nano-banana-pro, pricing depends on resolution
      let price = 0; // Default to free for admins

      if (!isAdminUser) {
        if (model.id === 'nano-banana-pro') {
          // We'll use default price for display purposes, actual price will be calculated when parameters are provided
          price = calculatePrice(model.pricing.credits); // This is for 1K/2K
        } else {
          price = calculatePrice(model.pricing.credits);
        }

        if (user.balance < price) {
          await ctx.answerCbQuery(`❌ Недостаточно средств. Требуется: ${formatPriceSafe(price)}`, { show_alert: true });
          return;
        }
      }

      // Create a form for model parameters based on input_schema
      if (model.input_schema && model.input_schema.properties) {
        // Check if model requires image input (for image-to-image models)
        const requiresImageInput = model.input_schema.properties.image_input ||
                                  model.input_schema.properties.input_urls ||
                                  model.input_schema.properties.image_urls ||
                                  model.modelType.includes('image-to-image') ||
                                  model.modelType.includes('img2img') ||
                                  model.modelType.includes('-to-image') && model.modelType.includes('image-');

        // Set user state to indicate they're in model parameter input mode
        userStates.set(userId, {
          mode: 'model_params',
          modelId: modelId,
          step: requiresImageInput ? 'ask_for_image' : 'params',  // Set correct step for image models
          timestamp: Date.now(),
          inputParams: {} // Initialize empty input parameters
        });

        const isAdminUser = isAdmin(userId);

        let formMessage = `*${model.name}*\n\n`;

        if (requiresImageInput) {
          formMessage += `🖼️ Эта модель требует входное изображение\n`;
          formMessage += `📤 Отправьте фото для начала генерации\n\n`;
        }

        if (isAdminUser) {
          formMessage += `Доступно бесплатно для администраторов\n\n`;
        } else {
          // Special pricing message for nano-banana-pro
          if (model.id === 'nano-banana-pro') {
            const price1k2k = calculatePrice(18); // 18 credits for 1K/2K
            const price4k = calculatePrice(24); // 24 credits for 4K
            formMessage += `Требуется: ${formatPriceSafe(price1k2k)} за 1K/2K или ${formatPriceSafe(price4k)} за 4K\n\n`;
          } else {
            formMessage += `Требуется: ${formatPriceSafe(price)}\n\n`;
          }
        }

        // Initialize step-by-step parameter collection
        userStates.set(userId, {
          mode: 'model_params',
          modelId: modelId,
          step: 'prompt', // Start with prompt
          inputParams: {}, // Initialize empty parameters object
          timestamp: Date.now()
        });

        formMessage += `Введите *текст запроса* (prompt):\n\n`;
        formMessage += `Это основной текст, описывающий изображение, которое вы хотите получить.`;

        await ctx.editMessageText(formMessage, {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [{ text: '◀️ Назад', callback_data: `model_${modelId}_cancel` }]
          ]).reply_markup
        });
      } else {
        await ctx.editMessageText(`*${model.name}*\n\nМодель не имеет описания параметров.`, {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [{ text: '◀️ Назад', callback_data: `model_${modelId}_cancel` }]
          ]).reply_markup
        });
      }
    }
    else if (callbackData.includes('_cancel')) {
      // Extract model ID from callback data (remove '_cancel' suffix)
      // This handles model_..._cancel pattern - returns user to model selection
      if (callbackData.startsWith('model_') && callbackData.endsWith('_cancel')) {
        const modelId = callbackData.substring(6, callbackData.length - 7); // Remove 'model_' and '_cancel'
        const model = await db.getModel(modelId);

        if (!model) {
          await ctx.answerCbQuery('❌ Модель не найдена.', { show_alert: true });
          return;
        }

        // Clear user state
        userStates.delete(userId);

        // Format model info
        const isAdminUser = isAdmin(userId);
        let response = formatModelInfo(model, isAdminUser);

        // Create keyboard with options to use model or go back to model selection
        const modelKeyboard = [
          [{ text: '🚀 Использовать модель', callback_data: `use_model_${modelId}` }],
          [{ text: '◀️ Назад', callback_data: 'select_model' }] // Return to model selection
        ];

        await ctx.editMessageText(response, {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard(modelKeyboard).reply_markup
        });
      }
    }
    else if (callbackData === 'search_models') {
      const models = await db.getModels();

      if (models.length === 0) {
        await ctx.editMessageText('🔍 В данный момент нет доступных моделей для поиска.', {
          reply_markup: Markup.inlineKeyboard([
            [{ text: '◀️ Назад', callback_data: 'main_menu' }]
          ]).reply_markup
        });
        return;
      }

      let response = '🔍 *Доступные модели:*\n\n';

      models.forEach((model, index) => {
        response += `${index + 1}. *${escapeMarkdown(model.name)}*\n`;
        response += `   Категория: ${escapeMarkdown(model.category)}\n`;
        if (model.description) {
          response += `   Описание: ${escapeMarkdown(model.description.substring(0, 100))}${model.description.length > 100 ? '...' : ''}\n`;
        }
        response += '\n';
      });

      await ctx.editMessageText(response, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [{ text: '◀️ Назад', callback_data: 'main_menu' }]
        ]).reply_markup
      });
    }
    else if (callbackData === 'balance_payment') {
      let user = await db.getUser(userId);
      const balance = user ? formatPrice(user.balance) : '0.00 ₽';
      const isAdminUser = isAdmin(userId);

      let message = `💰 *Ваш баланс:* ${balance}\n\n`;

      if (isAdminUser) {
        message += `👑 *${escapeMarkdown('Администраторский статус')}*\n`;
        message += `${escapeMarkdown('Для вас генерация доступна бесплатно и без ограничений.')}\n\n`;
      } else {
        message += `${escapeMarkdown('Для пополнения переведите средства на:')}\n\n`;
        message += `${escapeMarkdown(process.env.PAYMENT_REQUISITES_TEXT || 'Не указаны')}\n\n`;
        message += `${escapeMarkdown('После оплаты отправьте чек/скрин/ID администратору для подтверждения.')}`;
      }

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [{ text: '◀️ Назад', callback_data: 'main_menu' }]
        ]).reply_markup
      });
    }
    else if (callbackData === 'my_tasks') {
      const tasks = await db.getTasks();
      const userTasks = tasks.filter(t => t.userId === userId);

      if (userTasks.length === 0) {
        await ctx.editMessageText('📋 У вас пока нет задач.', {
          reply_markup: Markup.inlineKeyboard([
            [{ text: '◀️ Назад', callback_data: 'main_menu' }]
          ]).reply_markup
        });
        return;
      }

      let response = '📋 *Ваши задачи:*\n\n';
      for (let i = 0; i < Math.min(userTasks.length, 10); i++) {
        const task = userTasks[i];
        response += `${i + 1}. ${escapeMarkdown(task.modelType || 'Unknown')}\n`;
        response += `   Статус: ${escapeMarkdown(task.status || 'unknown')}\n`;
        response += `   Цена: ${formatPriceSafe(task.price || 0)}\n`;
        // Show payment status
        if (task.status === 'completed' && task.priceDeducted) {
          response += `   Платёж: ✅\n`;
        } else if (task.status === 'failed') {
          response += `   Платёж: ❌ (не удержана)\n`;
        } else if (task.status === 'completed' && !task.priceDeducted) {
          response += `   Платёж: ❌ (ошибка)\n`;
        } else {
          response += `   Платёж: ожидает завершения\n`;
        }
        response += `   Создано: ${new Date(task.createdAt || task.created_at).toLocaleString()}\n`;

        // If task is completed, show completion time
        if (task.completedAt) {
          response += `   Завершено: ${new Date(task.completedAt).toLocaleString()}\n`;
        }
        response += '\n';
      }

      if (userTasks.length > 10) {
        response += `И еще ${userTasks.length - 10} задач...`;
      }

      await ctx.editMessageText(response, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [{ text: '🔄 Обновить', callback_data: 'refresh_tasks' }],
          [{ text: '◀️ Назад', callback_data: 'main_menu' }]
        ]).reply_markup
      });
    }
    else if (callbackData === 'refresh_tasks') {
      // Prevent duplicate refresh requests (within 5 seconds)
      const lastRefresh = userStates.get(`refresh_${userId}`);
      const now = Date.now();
      if (lastRefresh && (now - lastRefresh.timestamp) < 5000) {
        await ctx.answerCbQuery('⏱️ Подождите перед обновлением.', { show_alert: true });
        return;
      }

      // Update last refresh time
      userStates.set(`refresh_${userId}`, { timestamp: now });

      // Check status of all pending tasks
      const allTasks = await db.getTasks();
      const userTasks = allTasks.filter(t => t.userId === userId && (t.status === 'created' || t.status === 'processing'));

      for (const task of userTasks) {
        try {
          const taskInfo = await kieApi.getTaskInfo(userId, task.id);

          if (taskInfo && taskInfo.state === 'success') {
            // Send photo to user if possible
            if (taskInfo.resultJson) {
              const resultData = JSON.parse(taskInfo.resultJson);
              if (resultData.resultUrls && resultData.resultUrls.length > 0) {
                // Send photo to user with validation
                for (const imageUrl of resultData.resultUrls) {
                  // Validate image URL
                  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
                    const errorId = 'IMAGE_URL_REFRESH_' + Date.now();
                    logger.logError('IMAGE_URL', `Invalid image URL received from API during refresh`, {
                      errorId: errorId,
                      taskId: task.id,
                      userId: userId,
                      imageUrl: imageUrl,
                      rawResult: taskInfo.resultJson
                    });
                    continue; // Skip invalid URLs
                  }

                  try {
                    await ctx.telegram.sendPhoto(userId, { url: imageUrl });
                  } catch (sendError) {
                    const errorId = 'SEND_REFRESH_' + Date.now();
                    logger.logError('PHOTO_SEND', `Failed to send image to user during refresh ${userId}`, {
                      errorId: errorId,
                      taskId: task.id,
                      userId: userId,
                      imageUrl: imageUrl,
                      errorName: sendError.name,
                      errorMessage: sendError.message,
                      stack: sendError.stack
                    });

                    // Try to send as document if photo fails
                    try {
                      await ctx.telegram.sendDocument(userId, { url: imageUrl });
                    } catch (docError) {
                      logger.logError('DOC_SEND', `Failed to send image as document during refresh to user ${userId}`, {
                        taskId: task.id,
                        userId: userId,
                        imageUrl: imageUrl,
                        errorName: docError.message,
                        errorMessage: docError.message
                      });
                    }
                  }
                }
              }
            }

            // NOW deduct price from user balance after successful generation
            // Only for non-admin users and if payment hasn't been deducted yet
            const userIsAdmin = isAdmin(userId);
            if (!userIsAdmin && !task.priceDeducted) {
              // Get current user balance to make sure we're using the right amount
              const currentUser = await db.getUser(userId);
              if (currentUser && currentUser.balance >= task.price) {
                await db.updateUser(userId, {
                  balance: currentUser.balance - task.price
                });

                // Update task status in database
                await db.updateTask(task.id, {
                  status: 'completed',
                  completedAt: new Date().toISOString(),
                  result: taskInfo.resultJson,
                  priceDeducted: true
                });

                // Send confirmation message about deduction
                try {
                  await ctx.reply(`💰 С вашего баланса списано: ${formatPriceSafe(task.price)}`);
                } catch (replyError) {
                  logger.logError(replyError, `Failed to send deduction confirmation to user ${userId}`);
                }
              } else {
                // Handle case where user doesn't have enough balance after task completion
                const errorId = 'BALANCE_' + Date.now();
                logger.logError('BALANCE', `Insufficient balance after task completion during refresh`, {
                  errorId: errorId,
                  taskId: task.id,
                  userId: userId,
                  required: task.price,
                  available: currentUser?.balance || 0
                });

                // Mark task as completed without payment deduction
                await db.updateTask(task.id, {
                  status: 'completed_no_payment',
                  completedAt: new Date().toISOString(),
                  result: taskInfo.resultJson,
                  priceDeducted: false,
                  errorId: errorId
                });
              }
            } else {
              // Update task status in database for admin or if already deducted
              await db.updateTask(task.id, {
                status: 'completed',
                completedAt: new Date().toISOString(),
                result: taskInfo.resultJson
              });

              // Update stats for admin (completed but no revenue)
              if (!task.priceDeducted) {
                systemStats.totalTasksCompleted++;
              }
            }
          } else if (taskInfo && taskInfo.state === 'fail') {
            await db.updateTask(task.id, {
              status: 'failed',
              failMsg: taskInfo.failMsg,
              priceDeducted: false // Ensure no payment is deducted for failed tasks
            });

            // Update stats for failed task
            if (task.status !== 'failed') {
              systemStats.totalTasksFailed++;
            }
          }
        } catch (error) {
          logger.logError(error, `Failed to refresh task ${task.id}`);
        }
      }

      // Refresh the tasks list
      const tasks = await db.getTasks();
      const userTasksRefreshed = tasks.filter(t => t.userId === userId);

      if (userTasksRefreshed.length === 0) {
        await ctx.editMessageText('📋 У вас пока нет задач.', {
          reply_markup: Markup.inlineKeyboard([
            [{ text: '◀️ Назад', callback_data: 'main_menu' }]
          ]).reply_markup
        });
        return;
      }

      let response = '📋 *Ваши задачи:*\n\n';
      for (let i = 0; i < Math.min(userTasksRefreshed.length, 10); i++) {
        const task = userTasksRefreshed[i];
        response += `${i + 1}. ${task.modelType}\n`;
        response += `   Статус: ${task.status || 'unknown'}\n`;
        response += `   Цена: ${formatPriceSafe(task.price || 0)}\n`;
        // Show payment status
        if (task.status === 'completed' && task.priceDeducted) {
          response += `   Платёж: ✅\n`;
        } else if (task.status === 'failed') {
          response += `   Платёж: ❌ (не удержана)\n`;
        } else if (task.status === 'completed' && !task.priceDeducted) {
          response += `   Платёж: ❌ (ошибка)\n`;
        } else {
          response += `   Платёж: ожидает завершения\n`;
        }
        response += `   Создано: ${new Date(task.createdAt || task.created_at).toLocaleString()}\n`;

        // If task is completed, show completion time
        if (task.completedAt) {
          response += `   Завершено: ${new Date(task.completedAt).toLocaleString()}\n`;
        }
        response += '\n';
      }

      if (userTasksRefreshed.length > 10) {
        response += `И еще ${userTasksRefreshed.length - 10} задач...`;
      }

      await ctx.editMessageText(response, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [{ text: '🔄 Обновить', callback_data: 'refresh_tasks' }],
          [{ text: '◀️ Назад', callback_data: 'main_menu' }]
        ]).reply_markup
      });
    }
    else if (callbackData === 'profile') {
      let user = await db.getUser(userId);

      if (!user) {
        await ctx.editMessageText('❌ Профиль не найден.', {
          reply_markup: Markup.inlineKeyboard([
            [{ text: '◀️ Назад', callback_data: 'main_menu' }]
          ]).reply_markup
        });
        return;
      }

      const isAdminUser = isAdmin(userId);
      const adminStatus = isAdminUser ? '👑 Администратор' : '👤 Пользователь';

      await ctx.editMessageText(
        `👤 *Ваш профиль*\n\n` +
        `ID: ${user.id}\n` +
        `Имя: ${escapeMarkdown(user.first_name || 'Не указано')}\n` +
        `Username: ${escapeMarkdown(user.username || 'Не указан')}\n` +
        `Баланс: ${formatPriceSafe(user.balance)}\n` +
        `Статус: ${escapeMarkdown(adminStatus)}\n` +
        `Дата регистрации: ${new Date(user.created_at).toLocaleDateString()}`,
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [{ text: '◀️ Назад', callback_data: 'main_menu' }]
          ]).reply_markup
        }
      );
    }
    else if (callbackData === 'help') {
      const isAdminUser = isAdmin(userId);
      let message = `*Доступные команды:*\n\n`;

      message += `${escapeMarkdown('🎨 Фото - генерация изображений')}\n`;
      message += `${escapeMarkdown('🔎 Поиск моделей - просмотр доступных моделей')}\n`;
      message += `${escapeMarkdown('💰 Баланс/Оплата - информация о балансе')}\n`;
      message += `${escapeMarkdown('🧾 Мои задачи - история ваших генераций')}\n`;
      message += `${escapeMarkdown('👤 Профиль - информация о вашем аккаунте')}\n`;
      message += `${escapeMarkdown('🆘 Помощь - это сообщение')}\n\n`;
      message += `${escapeMarkdown('ℹ️ Подсказки:')}\n`;
      message += `${escapeMarkdown('• Вводите параметры в формате JSON или просто текст для генерации изображений')}\n`;
      message += `${escapeMarkdown('• Максимальная длина промпта: 5000 символов')}\n`;
      message += `${escapeMarkdown('• Для отмены ввода параметров используйте кнопку "Назад"')}\n\n`;

      if (isAdminUser) {
        const isInUserViewMode = isAdminInUserViewMode(userId);
        message += `${escapeMarkdown('Для администраторов: /admin')}\n`;
        if (isInUserViewMode) {
          message += `${escapeMarkdown('Текущий режим: пользовательский (смотрите бота как обычный пользователь)')}\n`;
          message += `${escapeMarkdown('/adminmode - переключиться обратно в режим администратора')}\n`;
        } else {
          message += `${escapeMarkdown('/usermode - переключиться в режим просмотра как обычный пользователь')}\n`;
        }
        message += `${escapeMarkdown('👑 Генерация доступна бесплатно и без ограничений')}`;
      } else {
        message += `${escapeMarkdown('Для администраторов: /admin')}`;
      }

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [{ text: '◀️ Назад', callback_data: 'main_menu' }]
        ]).reply_markup
      });
    }
    else if (callbackData === 'check_connection' && isAdmin(userId)) {
      try {
        await ctx.editMessageText('🔍 Проверяю подключение к KIE API и Supabase...');

        // Check KIE API connection
        let kieResult;
        try {
          kieResult = await kieApi.testApiKey();
        } catch (error) {
          kieResult = {
            success: false,
            message: `Ошибка при проверке KIE API: ${error.message}`,
            error: error.message
          };
        }

        // Check Supabase connection
        let supabaseResult;
        try {
          const hasConnection = await db.checkSupabaseConnection();
          if (hasConnection) {
            supabaseResult = {
              success: true,
              message: '✅ Supabase: подключение активно и стабильно'
            };
          } else if (db.supabase) {
            // Try basic connectivity test
            const testResult = await db.getUsers();
            supabaseResult = {
              success: !!testResult,
              message: testResult ? '✅ Supabase: подключение активно и работает' :
                              '❌ Supabase: подключение настроено, но возникли проблемы при тесте'
            };
          } else {
            supabaseResult = {
              success: false,
              message: '⚠️ Supabase: не настроено (используется резервное хранилище)'
            };
          }
        } catch (error) {
          supabaseResult = {
            success: false,
            message: `❌ Supabase: ошибка при проверке подключения - ${error.message}`
          };
        }

        // Format response
        let response = `📡 *Результаты проверки подключения*\n\n`;
        response += `*KIE API*:\n`;
        if (kieResult.success) {
          response += `✅ ${kieResult.message}\n`;
          if (kieResult.response) {
            response += `   Код ответа: ${kieResult.response.code || 'unknown'}, `;
            response += `Сообщение: ${kieResult.response.msg || 'no message'}\n`;
          }
        } else {
          response += `❌ ${kieResult.message}\n`;
        }

        response += `\n*Supabase*:\n`;
        response += `${supabaseResult.message}\n`;

        // Add additional info based on configuration
        response += `\n*Конфигурация*:\n`;
        response += `KIE_API_KEY: ${process.env.KIE_API_KEY ? 'установлен' : 'не установлен'}\n`;
        response += `SUPABASE_URL: ${process.env.SUPABASE_URL ? 'установлен' : 'не установлен'}\n`;
        response += `SUPABASE_ANON_KEY: ${process.env.SUPABASE_ANON_KEY ? 'установлен' : 'не установлен'}\n`;
        response += `DRY_RUN: ${process.env.DRY_RUN === '1' ? 'активен (тестовый режим)' : 'неактивен (реальный режим)'}\n`;

        await ctx.editMessageText(response, {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [{ text: '🔄 Повторить проверку', callback_data: 'check_connection' }],
            [{ text: '👑 Админ панель', callback_data: 'admin_panel' }],
            [{ text: '◀️ Назад', callback_data: 'main_menu' }]
          ]).reply_markup
        });
      } catch (error) {
        logger.logError(error, `Failed to check connections via callback for user ${ctx.from.id}`);
        try {
          await ctx.editMessageText(`❌ Ошибка при проверке подключений: ${error.message}`);
        } catch (replyError) {
          logger.logError(replyError, `Failed to send connection check error message via callback`);
        }
      }
    }
    else if (callbackData === 'check_balance' && isAdmin(userId)) {
      try {
        await ctx.editMessageText('💰 Проверяю баланс на аккаунте KIE...');

        // Get account balance from API
        let balanceResult;
        try {
          balanceResult = await kieApi.getAccountBalance();
        } catch (error) {
          balanceResult = {
            success: false,
            message: `Ошибка при проверке баланса: ${error.message}`,
            error: error.message
          };
        }

        let response = `💳 *Баланс аккаунта KIE*\n\n`;
        if (balanceResult.success) {
          response += `✅ Баланс: ${balanceResult.balance} кредитов\n`;
          response += `ℹ️ ${escapeMarkdown(balanceResult.message)}\n`;
          if (balanceResult.response) {
            // Instead of including full JSON response (which can break markdown), just show key fields
            const responseSummary = {
              code: balanceResult.response.code,
              message: balanceResult.response.msg,
              remaining: balanceResult.response.remaining_credits || balanceResult.response.credits
            };
            response += `📋 Статус: ${escapeMarkdown(JSON.stringify(responseSummary))}\n`;
          }
        } else {
          response += `❌ ${escapeMarkdown(balanceResult.message)}\n`;
          if (balanceResult.error) {
            response += `⚠️ Ошибка: ${escapeMarkdown(balanceResult.error)}\n`;
          }
        }

        response += `\n*Конфигурация*:\n`;
        response += `DRY_RUN: ${process.env.DRY_RUN === '1' ? escapeMarkdown('активен (тестовый режим)') : escapeMarkdown('неактивен (реальный режим)')}\n`;

        await ctx.editMessageText(response, {
          reply_markup: Markup.inlineKeyboard([
            [{ text: '🔄 Повторить проверку', callback_data: 'check_balance' }],
            [{ text: '👑 Админ панель', callback_data: 'admin_panel' }],
            [{ text: '◀️ Назад', callback_data: 'main_menu' }]
          ]).reply_markup
        });
      } catch (error) {
        logger.logError(error, `Failed to check balance via callback for user ${ctx.from.id}`);
        try {
          await ctx.editMessageText(`❌ Ошибка при проверке баланса: ${error.message}`);
        } catch (replyError) {
          logger.logError(replyError, `Failed to send balance check error message via callback`);
        }
      }
    }
    else if (callbackData === 'admin_panel' && isAdmin(userId)) {
      const stats = await db.getUsers();
      const userCount = stats.length;

      const isInUserViewMode = isAdminInUserViewMode(userId);
      const modeText = isInUserViewMode ? 'Пользовательский режим (смотрите бота как обычный пользователь)' : 'Администраторский режим (стандартный режим)';

      await ctx.editMessageText(
        `👑 *Панель администратора*\n\n` +
        `*Текущий режим:* ${modeText}\n\n` +
        `${escapeMarkdown('Доступные команды:')}\n` +
        `${escapeMarkdown('/usermode - переключиться в режим просмотра как обычный пользователь')}\n` +
        `${escapeMarkdown('/adminmode - переключиться обратно в режим администратора')}\n` +
        `${escapeMarkdown('/checkconnection - проверить подключение к API')}\n` +
        `${escapeMarkdown('/checkbalance - проверить баланс токенов на KIE аккаунте')}\n` +
        `${escapeMarkdown('/syncmodels - синхронизировать модели')}\n` +
        `${escapeMarkdown('/setrate <rate> - установить курс USD/RUB')}\n` +
        `${escapeMarkdown('/setmarkup <markup> - установить наценку')}\n` +
        `${escapeMarkdown('/addbalance <userId> <amount> - пополнить баланс')}\n` +
        `${escapeMarkdown('/ban <userId> - заблокировать пользователя')}\n` +
        `${escapeMarkdown('/unban <userId> - разблокировать пользователя')}\n` +
        `${escapeMarkdown('/stats - статистика использования')}\n\n` +
        `${escapeMarkdown(`Всего пользователей: ${userCount}`)}`,
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [{ text: '📡 Проверить подключение', callback_data: 'check_connection' }],
            [{ text: '💳 Проверить баланс KIE', callback_data: 'check_balance' }],
            [{ text: '◀️ Назад', callback_data: 'main_menu' }]
          ]).reply_markup
        }
      );
    }
    
    await ctx.answerCbQuery(); // Answer the callback query
  } catch (error) {
    logger.logError(error, `Error handling callback query ${callbackData} for user ${userId}`);
    try {
      await ctx.answerCbQuery('❌ Произошла ошибка при обработке запроса', { show_alert: true });
    } catch (ansError) {
      logger.logError(ansError, `Failed to answer callback query`);
    }
  }
});

// Command to check user's tasks
bot.command('my_tasks', async (ctx) => {
  const userId = ctx.from.id;

  try {
    // Get user's tasks from database
    const allTasks = await db.getTasks();
    const userTasks = allTasks.filter(task => task.userId === userId);

    if (userTasks.length === 0) {
      await ctx.reply('📋 У вас пока нет задач.');
      return;
    }

    // Sort tasks by creation date (newest first)
    userTasks.sort((a, b) => new Date(b.createdAt || b.created_at) - new Date(a.createdAt || a.created_at));

    let response = `📋 *Ваши задачи* (последние 10 из ${userTasks.length}):\n\n`;

    // Show only last 10 tasks to avoid message being too long
    const tasksToShow = userTasks.slice(0, 10);

    for (let i = 0; i < tasksToShow.length; i++) {
      const task = tasksToShow[i];
      const status = task.status || 'unknown';
      const createdAt = new Date(task.createdAt || task.created_at).toLocaleString();
      const modelType = task.modelType || task.modelId || 'unknown';

      response += `${i + 1}. *ID:* ${task.id}\n`;
      response += `   *Модель:* ${escapeMarkdown(modelType)}\n`;
      response += `   *Статус:* ${escapeMarkdown(status)}\n`;
      response += `   *Создано:* ${createdAt}\n`;

      // If task has completed and has result, show result
      if (status === 'completed' && task.resultJson) {
        try {
          const resultData = JSON.parse(task.resultJson);
          if (resultData.resultUrls && resultData.resultUrls.length > 0) {
            response += `   *Результат:* ${escapeMarkdown(resultData.resultUrls[0])}\n`;
          }
        } catch (e) {
          // If JSON parsing fails, just skip showing result
        }
      }

      response += `\n`;
    }

    if (userTasks.length > 10) {
      response += `⚠️ Показаны последние 10 задач. Всего задач: ${userTasks.length}`;
    }

    await ctx.replyWithMarkdown(response);
  } catch (error) {
    logger.logError(error, `Error getting tasks for user ${userId}`);
    await ctx.reply(`❌ Ошибка получения списка задач: ${error.message}`);
  }
});

// Admin commands
bot.command('syncmodels', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    try {
      await ctx.reply('❌ Только администратор может выполнить эту команду.');
    } catch (error) {
      logger.logError(error, `Failed to send syncmodels error to user ${userId}`);
    }
    return;
  }
  
  try {
    await ctx.reply('🔄 Запускаю синхронизацию моделей...');
    await import('./scripts/kie-sync.mjs').then(sync => sync.syncModels());
    const models = await db.getModels();
    await ctx.reply(`✅ Синхронизация завершена! Модели: ${models.length} всего, ${models.filter(m => m.enabled).length} включено.`);
  } catch (error) {
    logger.logError(error, `Error during syncmodels command`);
    await ctx.reply(`❌ Ошибка синхронизации: ${error.message}`);
  }
});

bot.command('setrate', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    try {
      await ctx.reply('❌ Только администратор может выполнить эту команду.');
    } catch (error) {
      logger.logError(error, `Failed to send setrate error to user ${userId}`);
    }
    return;
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    try {
      await ctx.reply('❌ Использование: /setrate <новый_курс>');
    } catch (error) {
      logger.logError(error, `Failed to send setrate usage to user ${userId}`);
    }
    return;
  }
  
  const newRate = parseFloat(args[1]);
  if (isNaN(newRate)) {
    try {
      await ctx.reply('❌ Курс должен быть числом');
    } catch (error) {
      logger.logError(error, `Failed to send setrate NaN error to user ${userId}`);
    }
    return;
  }
  
  try {
    await db.updateSettings({ USD_TO_RUB: newRate });
    await ctx.reply(`✅ Курс USD/RUB изменен на: ${newRate}`);
    logger.logBot(`User ${userId} changed USD_TO_RUB rate to ${newRate}`);
  } catch (error) {
    logger.logError(error, `Error updating rate`);
    await ctx.reply(`❌ Ошибка обновления курса: ${error.message}`);
  }
});

bot.command('setmarkup', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    try {
      await ctx.reply('❌ Только администратор может выполнить эту команду.');
    } catch (error) {
      logger.logError(error, `Failed to send setmarkup error to user ${userId}`);
    }
    return;
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    try {
      await ctx.reply('❌ Использование: /setmarkup <новая_наценка>');
    } catch (error) {
      logger.logError(error, `Failed to send setmarkup usage to user ${userId}`);
    }
    return;
  }
  
  const newMarkup = parseFloat(args[1]);
  if (isNaN(newMarkup)) {
    try {
      await ctx.reply('❌ Наценка должна быть числом');
    } catch (error) {
      logger.logError(error, `Failed to send setmarkup NaN error to user ${userId}`);
    }
    return;
  }
  
  try {
    await db.updateSettings({ MARKUP: newMarkup });
    await ctx.reply(`✅ Наценка изменена на: ${newMarkup}x`);
    logger.logBot(`User ${userId} changed markup to ${newMarkup}`);
  } catch (error) {
    logger.logError(error, `Error updating markup`);
    await ctx.reply(`❌ Ошибка обновления наценки: ${error.message}`);
  }
});

bot.command('addbalance', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    try {
      await ctx.reply('❌ Только администратор может выполнить эту команду.');
    } catch (error) {
      logger.logError(error, `Failed to send addbalance error to user ${userId}`);
    }
    return;
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 3) {
    try {
      await ctx.reply('❌ Использование: /addbalance <userId> <сумма>');
    } catch (error) {
      logger.logError(error, `Failed to send addbalance usage to user ${userId}`);
    }
    return;
  }
  
  const targetUserId = parseInt(args[1]);
  const amount = parseFloat(args[2]);
  
  if (isNaN(targetUserId) || isNaN(amount)) {
    try {
      await ctx.reply('❌ UserId и сумма должны быть числами');
    } catch (error) {
      logger.logError(error, `Failed to send addbalance format error to user ${userId}`);
    }
    return;
  }
  
  try {
    let user = await db.getUser(targetUserId);
    if (!user) {
      await ctx.reply(`❌ Пользователь с ID ${targetUserId} не найден`);
      return;
    }
    
    const newBalance = user.balance + amount;
    await db.updateUser(targetUserId, { balance: newBalance });
    
    await ctx.reply(`✅ Баланс пользователя ${targetUserId} пополнен на ${formatPrice(amount)}. Новый баланс: ${formatPrice(newBalance)}`);
    logger.logBot(`Admin ${userId} added ${amount} to user ${targetUserId} balance`);
  } catch (error) {
    logger.logError(error, `Error adding balance`);
    await ctx.reply(`❌ Ошибка пополнения баланса: ${error.message}`);
  }
});

bot.command('ban', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    try {
      await ctx.reply('❌ Только администратор может выполнить эту команду.');
    } catch (error) {
      logger.logError(error, `Failed to send ban error to user ${userId}`);
    }
    return;
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    try {
      await ctx.reply('❌ Использование: /ban <userId>');
    } catch (error) {
      logger.logError(error, `Failed to send ban usage to user ${userId}`);
    }
    return;
  }
  
  const targetUserId = parseInt(args[1]);
  if (isNaN(targetUserId)) {
    try {
      await ctx.reply('❌ UserId должен быть числом');
    } catch (error) {
      logger.logError(error, `Failed to send ban NaN error to user ${userId}`);
    }
    return;
  }
  
  try {
    await db.updateUser(targetUserId, { is_banned: true });
    await ctx.reply(`✅ Пользователь ${targetUserId} заблокирован`);
    logger.logBot(`Admin ${userId} banned user ${targetUserId}`);
  } catch (error) {
    logger.logError(error, `Error banning user`);
    await ctx.reply(`❌ Ошибка блокировки: ${error.message}`);
  }
});

bot.command('unban', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    try {
      await ctx.reply('❌ Только администратор может выполнить эту команду.');
    } catch (error) {
      logger.logError(error, `Failed to send unban error to user ${userId}`);
    }
    return;
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    try {
      await ctx.reply('❌ Использование: /unban <userId>');
    } catch (error) {
      logger.logError(error, `Failed to send unban usage to user ${userId}`);
    }
    return;
  }
  
  const targetUserId = parseInt(args[1]);
  if (isNaN(targetUserId)) {
    try {
      await ctx.reply('❌ UserId должен быть числом');
    } catch (error) {
      logger.logError(error, `Failed to send unban NaN error to user ${userId}`);
    }
    return;
  }
  
  try {
    await db.updateUser(targetUserId, { is_banned: false });
    await ctx.reply(`✅ Пользователь ${targetUserId} разблокирован`);
    logger.logBot(`Admin ${userId} unbanned user ${targetUserId}`);
  } catch (error) {
    logger.logError(error, `Error unbanning user`);
    await ctx.reply(`❌ Ошибка разблокировки: ${error.message}`);
  }
});

bot.command('stats', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    try {
      await ctx.reply('❌ Только администратор может выполнить эту команду.');
    } catch (error) {
      logger.logError(error, `Failed to send stats error to user ${userId}`);
    }
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
    response += `Общий баланс пользователей: ${formatPriceSafe(totalBalance)}\n\n`;

    // Add system stats
    response += `*Системная статистика:*\n`;
    response += `Создано задач: ${systemStats.totalTasksCreated}\n`;
    response += `Успешно завершено: ${systemStats.totalTasksCompleted}\n`;
    response += `Провалено: ${systemStats.totalTasksFailed}\n`;
    response += `Общий доход: ${formatPriceSafe(systemStats.totalRevenue)}\n`;
    response += `Активных пользователей: ${systemStats.activeUsers.size}\n`;
    response += `Запущен: ${new Date(systemStats.startTime).toLocaleString()}\n`;

    await ctx.replyWithMarkdown(response);
  } catch (error) {
    logger.logError(error, `Error getting stats`);
    await ctx.reply(`❌ Ошибка получения статистики: ${error.message}`);
  }
});

// Self-check command for diagnostics
bot.command('selfcheck', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    try {
      await ctx.reply('❌ Только администратор может запустить self-check.');
    } catch (error) {
      logger.logError(error, `Failed to send selfcheck error to user ${userId}`);
    }
    return;
  }
  
  try {
    await ctx.reply('🔍 Запускаю диагностику...');

    // Check models
    const models = await db.getModels();
    const enabledModels = models.filter(m => m.enabled);

    // Check KIE API
    const apiOk = await kieApi.healthCheck();

    let response = '📋 *Результаты диагностики:*\n\n';
    response += `Модели: ${models.length} всего, ${enabledModels.length} включено\n`;
    response += `KIE API: ${apiOk ? '✅ Доступен' : '❌ Недоступен'}\n`;
    response += `База данных: ✅ Работает\n`;

    await ctx.replyWithMarkdown(response);
  } catch (error) {
    logger.logError(error, `Error during selfcheck`);
    await ctx.reply(`❌ Ошибка диагностики: ${error.message}`);
  }
});

// Command to switch to user view mode
bot.command('usermode', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    try {
      await ctx.reply('❌ Только администратор может использовать эту команду.');
    } catch (error) {
      logger.logError(error, `Failed to send usermode error to user ${userId}`);
    }
    return;
  }

  try {
    adminViewModes.set(userId, true);
    await ctx.reply('✅ Переключено в режим просмотра как обычный пользователь.\n\nТеперь вы видите бота так же, как его видят обычные пользователи.');
  } catch (error) {
    logger.logError(error, `Failed to switch to user mode for user ${userId}`);
    await ctx.reply(`❌ Ошибка переключения в режим пользователя: ${error.message}`);
  }
});

// Command to switch back to admin mode
bot.command('adminmode', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    try {
      await ctx.reply('❌ Только администратор может использовать эту команду.');
    } catch (error) {
      logger.logError(error, `Failed to send adminmode error to user ${userId}`);
    }
    return;
  }

  try {
    adminViewModes.set(userId, false);
    await ctx.reply('✅ Переключено в режим администратора.\n\nТеперь вы видите бота в обычном режиме администратора.');
  } catch (error) {
    logger.logError(error, `Failed to switch to admin mode for user ${userId}`);
    await ctx.reply(`❌ Ошибка переключения в режим администратора: ${error.message}`);
  }
});

// Command to initiate balance recharge process
bot.command('recharge', async (ctx) => {
  const userId = ctx.from.id;

  try {
    await ctx.replyWithMarkdown(
      `💳 *Пополнение баланса*\n\n` +
      `Введите сумму в рублях, на которую вы хотите пополнить баланс:\n\n` +
      `Пример: \`1000\` для пополнения на 1000 рублей\n` +
      `*Важно:* После ввода суммы вы получите реквизиты для оплаты через СБП`
    );
  } catch (error) {
    logger.logError(error, `Failed to send recharge instruction to user ${userId}`);
    await ctx.reply(`❌ Ошибка при попытке начать процесс пополнения: ${error.message}`);
  }
});

// Command to view payment screenshots for admin review
bot.command('payments', async (ctx) => {
  const userId = ctx.from.id;
  if (!isAdmin(userId)) {
    try {
      await ctx.reply('❌ Только администратор может использовать эту команду.');
    } catch (error) {
      logger.logError(error, `Failed to send payments error to user ${userId}`);
    }
    return;
  }

  try {
    // Get pending payments
    const pendingPayments = paymentScreenshots.filter(p => p.status === 'pending');

    if (pendingPayments.length === 0) {
      await ctx.reply('📋 *Все платежи обработаны, новых платежей нет.*', { parse_mode: 'Markdown' });
      return;
    }

    let response = `📋 *Платежи на проверке (${pendingPayments.length} шт.)*\n\n`;

    for (const payment of pendingPayments) {
      const user = payment.user || { first_name: 'Unknown', username: 'unknown' };
      response += `🔹 ID: ${payment.id}\n`;
      response += `👤 Пользователь: ${user.first_name} (@${user.username || 'no_username'})\n`;
      response += `💰 Сумма: ${payment.amount} ₽\n`;
      response += `📅 ${new Date(payment.timestamp).toLocaleString()}\n`;
      response += `🔸 Статус: ${payment.status}\n`;
      response += `➡️ /approve_${payment.id} - одобрить\n`;
      response += `❌ /reject_${payment.id} - отклонить\n`;
      response += `---\n`;
    }

    await ctx.replyWithMarkdown(response);
  } catch (error) {
    logger.logError(error, `Failed to get payments for admin ${userId}`);
    await ctx.reply(`❌ Ошибка получения списка платежей: ${error.message}`);
  }
});

// Listen for approve/reject commands with dynamic payment IDs
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const messageText = ctx.message.text;

  // Check if user is admin and message is an approve/reject command
  if (!isAdmin(userId)) {
    return; // Only admins can use these commands, and only return if it's not an approve/reject command
  }

  // Match approve command pattern: /approve_payment_xxxx_yyyy
  const approveMatch = messageText.match(/^\/approve_(payment_\d+_\d+)$/);
  if (approveMatch) {
    const paymentId = approveMatch[1];

    const payment = paymentScreenshots.find(p => p.id === paymentId);

    if (!payment) {
      await ctx.reply('❌ Платеж не найден.');
      return;
    }

    try {
      // Update user balance
      const user = await db.getUser(payment.userId);
      if (!user) {
        await ctx.reply('❌ Пользователь не найден.');
        return;
      }

      // Update user balance
      const newBalance = (user.balance || 0) + payment.amount;
      await db.updateUser(payment.userId, { balance: newBalance });

      // Update payment status
      payment.status = 'approved';
      payment.adminReviewed = userId;
      payment.reviewedAt = Date.now();

      await ctx.reply(`✅ Платеж ${paymentId} одобрен.\nБаланс пользователя ${payment.userId} пополнен на ${payment.amount} ₽.\nНовый баланс: ${newBalance} ₽`);

      // Notify user about successful payment processing
      try {
        await ctx.telegram.sendMessage(
          payment.userId,
          `✅ *ПЛАТЕЖ ОДОБРЕН*\n\n` +
          `Ваш баланс пополнен на ${payment.amount} ₽.\n` +
          `Новый баланс: ${newBalance} ₽`,
          { parse_mode: 'Markdown' }
        );
      } catch (notifyErr) {
        logger.logError(notifyErr, `Failed to notify user ${payment.userId} about approved payment`);
      }
    } catch (error) {
      logger.logError(error, `Failed to approve payment ${paymentId} for admin ${userId}`);
      await ctx.reply(`❌ Ошибка одобрения платежа: ${error.message}`);
    }
    return; // Exit after processing approve command
  }

  // Match reject command pattern: /reject_payment_xxxx_yyyy
  const rejectMatch = messageText.match(/^\/reject_(payment_\d+_\d+)$/);
  if (rejectMatch) {
    const paymentId = rejectMatch[1];

    const payment = paymentScreenshots.find(p => p.id === paymentId);

    if (!payment) {
      await ctx.reply('❌ Платеж не найден.');
      return;
    }

    try {
      // Update payment status
      payment.status = 'rejected';
      payment.adminReviewed = userId;
      payment.reviewedAt = Date.now();

      await ctx.reply(`❌ Платеж ${paymentId} отклонен.`);

      // Notify user about rejected payment
      try {
        await ctx.telegram.sendMessage(
          payment.userId,
          `❌ *ПЛАТЕЖ ОТКЛОНЕНИЕ*\n\n` +
          `Ваш платёж на сумму ${payment.amount} ₽ был отклонён администратором.`,
          { parse_mode: 'Markdown' }
        );
      } catch (notifyErr) {
        logger.logError(notifyErr, `Failed to notify user ${payment.userId} about rejected payment`);
      }
    } catch (error) {
      logger.logError(error, `Failed to reject payment ${paymentId} for admin ${userId}`);
      await ctx.reply(`❌ Ошибка отклонения платежа: ${error.message}`);
    }
    return; // Exit after processing reject command
  }
});

// System Statistics
let systemStats = {
  totalTasksCreated: 0,
  totalTasksCompleted: 0,
  totalTasksFailed: 0,
  totalRevenue: 0,
  activeUsers: new Set(),
  startTime: new Date().toISOString()
};

// On bot launch
async function startBot() {
  logger.logBot('Initializing database and models...');
  await runDoctor();

  const models = await db.getModels();
  logger.logBot(`Models loaded: ${models.length} total, ${models.filter(m => m.enabled).length} enabled`);

  // Load stats from database
  const tasks = await db.getTasks();
  systemStats.totalTasksCreated = tasks.length;
  systemStats.totalTasksCompleted = tasks.filter(t => t.status === 'completed' && t.priceDeducted).length;
  systemStats.totalTasksFailed = tasks.filter(t => t.status === 'failed').length;
  systemStats.totalRevenue = tasks.filter(t => t.status === 'completed' && t.priceDeducted)
                                 .reduce((sum, task) => sum + (task.price || 0), 0);

  logger.logBot('Starting Telegram bot...');
  await bot.launch();

  // Log system statistics
  logger.logBot('System Statistics', {
    totalTasksCreated: systemStats.totalTasksCreated,
    totalTasksCompleted: systemStats.totalTasksCompleted,
    totalTasksFailed: systemStats.totalTasksFailed,
    totalRevenue: systemStats.totalRevenue,
    enabledModels: models.filter(m => m.enabled).length,
    startTime: systemStats.startTime
  });

  logger.logBot('READY - Bot is running!');

  // Enable graceful stop
  process.once('SIGINT', () => {
    logger.logBot('Received SIGINT, stopping bot...');
    // Log final statistics
    logger.logBot('Final System Statistics', systemStats);
    // Clear user states before stopping
    userStates.clear();
    bot.stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    logger.logBot('Received SIGTERM, stopping bot...');
    // Log final statistics
    logger.logBot('Final System Statistics', systemStats);
    // Clear user states before stopping
    userStates.clear();
    bot.stop('SIGTERM');
  });

  // Regular stats update (every 10 minutes)
  setInterval(async () => {
    try {
      const tasks = await db.getTasks();
      systemStats.totalTasksCreated = tasks.length;
      systemStats.totalTasksCompleted = tasks.filter(t => t.status === 'completed' && t.priceDeducted).length;
      systemStats.totalTasksFailed = tasks.filter(t => t.status === 'failed').length;
      systemStats.totalRevenue = tasks.filter(t => t.status === 'completed' && t.priceDeducted)
                                     .reduce((sum, task) => sum + (task.price || 0), 0);
    } catch (error) {
      logger.logError('STATS', 'Error updating system stats', { error: error.message });
    }
  }, 10 * 60 * 1000); // Every 10 minutes
}

// Helper function to ask for aspect ratio
async function askAspectRatio(ctx, userState, model) {
  // Check if this is a video model that might have different aspect ratio handling
  const isVideoModel = model.modelType.includes('video') || model.modelType.includes('video');

  // Safely check if model has input_schema and properties
  if (model.input_schema && model.input_schema.properties && model.input_schema.properties.aspect_ratio) {
    const validAspectRatios = model.input_schema.properties.aspect_ratio.enum || [];
    if (validAspectRatios.length > 0) {
      userState.step = 'aspect_ratio';
      userStates.set(ctx.from.id, userState);

      let message = `📐 Введите соотношение сторон:\n`;
      message += `${validAspectRatios.join(', ')}\n\n`;

      if (model.input_schema.properties.aspect_ratio.default) {
        message += `Текущее значение по умолчанию: ${model.input_schema.properties.aspect_ratio.default}`;
      } else {
        message += `Текущее значение по умолчанию: 1:1`;
      }

      // Add special note for video models
      if (isVideoModel) {
        message += `\n\nДля видео моделей соотношение сторон влияет на формат вывода.`;
      }

      await ctx.reply(message);
      return; // Early return to avoid proceeding to next function
    }
  }

  // Skip to next parameter if not required
  await askResolution(ctx, userState, model);
}

// Helper function to ask for resolution
async function askResolution(ctx, userState, model) {
  // Check if this is a video model that might have different resolution handling
  const isVideoModel = model.modelType.includes('video') || model.modelType.includes('video');

  // Safely check if model has input_schema and properties
  if (model.input_schema && model.input_schema.properties && model.input_schema.properties.resolution) {
    const validResolutions = model.input_schema.properties.resolution.enum || [];
    if (validResolutions.length > 0) {
      userState.step = 'resolution';
      userStates.set(ctx.from.id, userState);

      let message = `📏 Введите разрешение:\n`;
      message += `${validResolutions.join(', ')}\n\n`;

      if (model.input_schema.properties.resolution.default) {
        message += `Текущее значение по умолчанию: ${model.input_schema.properties.resolution.default}`;
      } else {
        message += `Текущее значение по умолчанию: 1K`;
      }

      // Add special note for video models
      if (isVideoModel) {
        message += `\n\nДля видео моделей разрешение влияет на качество и стоимость генерации.`;
      }

      await ctx.reply(message);
      return; // Early return to avoid proceeding to next function
    }
  }

  // Skip to next parameter if not required
  await askOutputFormat(ctx, userState, model);
}

// Helper function to ask for output format
async function askOutputFormat(ctx, userState, model) {
  // For video models, we might need to ask different parameters
  const isVideoModel = model.modelType.includes('video') || model.modelType.includes('video');

  if (isVideoModel) {
    // For video models like bytedance/grok-imagine/hailuo/sora, we might need to ask for duration
    if (model.input_schema.properties.duration) {
      const validDurations = model.input_schema.properties.duration?.enum || [];
      if (validDurations.length > 0) {
        userState.step = 'duration'; // Changed to duration step for video models
        userStates.set(ctx.from.id, userState);

        let message = `⏱ Введите продолжительность видео:\n`;
        message += `${validDurations.join(', ')}\n\n`;

        if (model.input_schema.properties.duration?.default) {
          message += `Текущее значение по умолчанию: ${model.input_schema.properties.duration.default}`;
        } else {
          message += `Текущее значение по умолчанию: 5`;
        }

        // Add pricing info for different durations
        if (model.id.includes('bytedance')) {
          message += `\n\nЦены:\n`;
          message += `5с: ${calculatePrice(16)} за 720p, ${calculatePrice(36)} за 1080p\n`;
          message += `10с: ${calculatePrice(36)} за 720p, ${calculatePrice(72)} за 1080p`;
        } else if (model.id.includes('hailuo')) {
          message += `\n\nЦены:\n`;
          message += `6с: ${calculatePrice(30)} (Standard) или ${calculatePrice(45)} (Pro) за 768P\n`;
          message += `6с: ${calculatePrice(50)} (Standard) или ${calculatePrice(80)} (Pro) за 1080P\n`;
          message += `10с: ${calculatePrice(50)} (Standard) или ${calculatePrice(90)} (Pro) за 768P`;
        }

        await ctx.reply(message);
        return; // Early return to handle video-specific parameter
      }
    } else if (model.id.includes('sora-2')) {
      // For SORA models, ask for n_frames
      const validFrameCounts = model.input_schema.properties.n_frames?.enum || [];
      if (validFrameCounts.length > 0) {
        userState.step = 'n_frames'; // Set to n_frames step for SORA models
        userStates.set(ctx.from.id, userState);

        let message = `⏱ Введите длительность видео в секундах:\n`;
        message += `${validFrameCounts.join(', ')}\n\n`;

        if (model.input_schema.properties.n_frames?.default) {
          message += `Текущее значение по умолчанию: ${model.input_schema.properties.n_frames.default}`;
        } else {
          message += `Текущее значение по умолчанию: 10`;
        }

        message += `\n\nЦены:\n`;
        message += `10с: ${calculatePrice(150)}, 15-25с: ${calculatePrice(270)}`;

        await ctx.reply(message);
        return; // Early return to handle SORA-specific parameter
      }
    }
  }

  // For image models, continue with output format
  if (model.input_schema && model.input_schema.properties && model.input_schema.properties.output_format) {
    const validFormats = model.input_schema.properties.output_format.enum || [];
    if (validFormats.length > 0) {
      userState.step = 'output_format';
      userStates.set(ctx.from.id, userState);

      let message = `🖼️ Введите формат вывода:\n`;
      message += `${validFormats.join(', ')}\n\n`;

      if (model.input_schema.properties.output_format.default) {
        message += `Текущее значение по умолчанию: ${model.input_schema.properties.output_format.default}`;
      } else {
        message += `Текущее значение по умолчанию: png`;
      }

      await ctx.reply(message);
      return; // Early return to avoid proceeding to next step
    }
  }

  // All parameters collected, proceed to task creation
  await createTaskFromParams(ctx, userState, model);
}

// Helper function to create task from collected parameters
async function createTaskFromParams(ctx, userState, model) {
  await ctx.reply('✅ Все параметры собраны. Готовлюсь к генерации...');

  // Get user and check if admin (for free generation)
  const user = await db.getUser(ctx.from.id);
  if (!user) {
    await ctx.reply('❌ Пользователь не найден.');
    userStates.delete(ctx.from.id); // Clear state on error
    return;
  }

  const isAdminUser = isAdmin(ctx.from.id);

  // Calculate price based on model and resolution/parameters (only for non-admin users)
  let price = 0; // Default to 0 for admin

  if (!isAdminUser) {
    price = calculatePrice(model.pricing.credits);

    // For different models, price calculation may differ based on parameters
    if (model.id === 'nano-banana-pro') {
      // For nano-banana-pro, price depends on resolution
      // Default to 1K/2K price (18 credits -> calculatePrice)
      // If resolution is 4K, price should be for 24 credits
      if (userState.inputParams.resolution === '4K') {
        price = calculatePrice(24); // 24 credits for 4K
      } else {
        price = calculatePrice(18); // 18 credits for 1K/2K
      }
    } else if (model.id.includes('bytedance')) {
      // For ByteDance models, price depends on resolution and duration
      if (userState.inputParams.resolution === '1080p') {
        if (userState.inputParams.duration === '10') {
          price = calculatePrice(72); // 72 credits for 1080p 10s
        } else {
          price = calculatePrice(36); // 36 credits for 1080p 5s
        }
      } else {
        // 720p pricing
        if (userState.inputParams.duration === '10') {
          price = calculatePrice(36); // 36 credits for 720p 10s
        } else {
          price = calculatePrice(16); // 16 credits for 720p 5s
        }
      }
    } else if (model.id.includes('hailuo')) {
      // For Hailuo models, price depends on resolution and duration
      if (userState.inputParams.resolution === '1080P') {
        if (userState.inputParams.duration === '10') {
          price = calculatePrice(90); // 90 credits for Pro 10s 1080P
        } else {
          price = calculatePrice(80); // 80 credits for Pro 6s 1080P
        }
      } else {
        // 768P pricing
        if (userState.inputParams.duration === '10') {
          price = calculatePrice(90); // 90 credits for Pro 10s 768P
        } else {
          price = calculatePrice(45); // 45 credits for Pro 6s 768P
        }
      }
    } else if (model.id.includes('sora')) {
      // For Sora models, price depends on video length
      if (userState.inputParams.n_frames === '10') {
        price = calculatePrice(150); // 150 credits for 10s video
      } else {
        price = calculatePrice(270); // 270 credits for 15-25s video
      }
    } else if (model.id.includes('grok-imagine')) {
      // For Grok Imagine models, price is fixed
      price = calculatePrice(model.pricing.credits);
    } else if (model.id.includes('flux-2')) {
      // For Flux 2 models - pricing depends on resolution
      if (userState.inputParams.resolution === '2K') {
        if (model.id.includes('flex')) {
          // Flux 2 Flex costs more for 2K
          price = calculatePrice(24); // 24 credits for 2K in Flex models
        } else {
          // Flux 2 Pro costs 7 credits for 2K
          price = calculatePrice(7); // 7 credits for 2K in Pro models
        }
      } else {
        // Default resolution (1K) pricing
        if (model.id.includes('flex')) {
          // Flux 2 Flex costs more for 1K
          price = calculatePrice(14); // 14 credits for 1K in Flex models
        } else {
          // Flux 2 Pro costs 5 credits for 1K
          price = calculatePrice(5); // 5 credits for 1K in Pro models
        }
      }
    }

    if (user.balance < price) {
      await ctx.reply(`❌ Недостаточно средств. Требуется: ${formatPriceSafe(price)}`);
      userStates.delete(ctx.from.id); // Clear state on error
      return;
    }
  } else {
    // Admin gets free generation
    price = 0;
  }

  // Provide feedback about the generation that's about to happen
  let generationInfo = `🖼️ Генерация изображения начата\n`;
  generationInfo += `📝 Промпт: ${escapeMarkdown(userState.inputParams.prompt ? userState.inputParams.prompt.substring(0, 50) + (userState.inputParams.prompt.length > 50 ? '...' : '') : 'не указан')}\n`;

  // Show image count if images are provided
  if (userState.inputParams.image_input && userState.inputParams.image_input.length > 0) {
    generationInfo += `🖼️ Изображений: ${userState.inputParams.image_input.length}\n`;
  }

  if (userState.inputParams.resolution) {
    generationInfo += `📏 Разрешение: ${escapeMarkdown(userState.inputParams.resolution)}\n`;
  }
  if (userState.inputParams.aspect_ratio) {
    generationInfo += `📐 Соотношение: ${escapeMarkdown(userState.inputParams.aspect_ratio)}\n`;
  }
  if (userState.inputParams.output_format) {
    generationInfo += `🖼️ Формат: ${escapeMarkdown(userState.inputParams.output_format)}\n`;
  }

  if (!isAdminUser) {
    generationInfo += `💳 Спишется: ${formatPriceSafe(price)}\n`;
  } else {
    generationInfo += `👑 Для администраторов: бесплатно\n`;
  }

  await ctx.reply(generationInfo);

  // Determine if this is a Flux model that requires different parameter structure
  const isFluxModel = model.modelType.includes('flux-2/') || model.modelType.includes('flux-2');

  // Prepare input parameters based on model type
  let apiInputParams = { ...userState.inputParams };

  if (isFluxModel) {
    // For Flux models, map parameters to the new API structure
    apiInputParams = {};

    // Map parameters to Flux API structure
    if (userState.inputParams.prompt) {
      apiInputParams.prompt = userState.inputParams.prompt;
    }
    if (userState.inputParams.image_input || userState.inputParams.input_urls) {
      // Flux expects input_urls instead of image_input
      apiInputParams.input_urls = userState.inputParams.image_input || userState.inputParams.input_urls;
    }
    if (userState.inputParams.aspect_ratio) {
      apiInputParams.aspect_ratio = userState.inputParams.aspect_ratio;
    }
    if (userState.inputParams.resolution) {
      apiInputParams.resolution = userState.inputParams.resolution;
    }
    // Add any other parameters that might be specific to Flux models
    if (userState.inputParams.output_format) {
      apiInputParams.output_format = userState.inputParams.output_format;
    }
  }

  // Validate input parameters before creating task
  if (!model.modelType || typeof model.modelType !== 'string') {
    logger.logError('KIE_API', 'Invalid model type provided in createTaskFromParams', {
      userId: ctx.from.id,
      modelId: model.id,
      modelType: model.modelType,
      modelTypeType: typeof model.modelType
    });
    await ctx.reply('❌ Некорректный тип модели. Пожалуйста, выберите другую модель.');
    userStates.delete(ctx.from.id); // Clear state on error
    return;
  }

  // Create task via KIE API
  let taskResult;
  try {
    // Additional validation before API call
    if (!apiInputParams || typeof apiInputParams !== 'object') {
      logger.logError('KIE_API', 'Invalid input parameters provided in createTaskFromParams', {
        userId: ctx.from.id,
        modelId: model.id,
        modelType: model.modelType,
        apiInputParams: apiInputParams,
        apiInputParamsType: typeof apiInputParams
      });
      await ctx.reply('❌ Некорректные параметры запроса. Пожалуйста, проверьте введенные данные.');
      userStates.delete(ctx.from.id); // Clear state on error
      return;
    }

    // Additional validation for specific model requirements
    if (model.modelType && (model.modelType.includes('flux-2') || model.modelType.includes('sora') || model.modelType.includes('bytedance'))) {
      // For these models, we typically need a prompt
      if (!apiInputParams.prompt || typeof apiInputParams.prompt !== 'string' || apiInputParams.prompt.trim() === '') {
        // Allow empty prompt for some specific cases but warn
        logger.logBot(`[VALIDATION] Model ${model.modelType} called without prompt in createTaskFromParams`, {
          userId: ctx.from.id,
          modelType: model.modelType,
          hasPrompt: !!apiInputParams.prompt,
          promptType: typeof apiInputParams.prompt,
          promptValue: apiInputParams.prompt
        });
      }
    }

    taskResult = await kieApi.createTask(ctx.from.id, model.modelType, apiInputParams);
  } catch (apiError) {
    // Detailed error logging for debugging
    const errorId = 'TASK_' + Date.now();
    logger.logError('KIE_API', `Error creating task via KIE API for user ${ctx.from.id}`, {
      errorId: errorId,
      userId: ctx.from.id,
      modelId: model.id,
      modelType: model.modelType,
      inputParams: apiInputParams, // Updated to reflect actual params sent
      originalInputParams: userState.inputParams, // Keep original for reference
      isFluxModel: model.modelType.includes('flux-2'),
      errorName: apiError.name,
      errorMessage: apiError.message,
      errorCode: apiError.code, // Include error code if available
      errorResponse: apiError.response?.data, // Include response data if available
      errorStatus: apiError.response?.status, // Include status code if available
      errorHeaders: apiError.response?.headers, // Include response headers for debugging
      stack: apiError.stack,
      isAdmin: isAdmin(ctx.from.id),
      apiKeyPresent: !!process.env.KIE_API_KEY, // Check if API key is present
      dryRunMode: process.env.DRY_RUN === '1', // Check current mode
      userBalance: user?.balance // Include user balance for context
    });

    // Send user-friendly message with error code
    if (apiError.code === 'DUPLICATE_REQUEST') {
      await ctx.reply(`⏱️ Пожалуйста, подождите перед отправкой нового запроса.`);
    } else {
      // Provide more specific error message based on error type
      let userErrorMessage = `❌ Ошибка при создании задачи. Пожалуйста, проверьте параметры и попробуйте снова. (код ошибки: ${errorId})`;

      // Add specific error details for common issues
      if (apiError.response?.status === 401) {
        userErrorMessage = `❌ Ошибка аутентификации. Пожалуйста, проверьте API-ключ. (код ошибки: ${errorId})`;
      } else if (apiError.response?.status === 403) {
        userErrorMessage = `❌ Доступ запрещен. Пожалуйста, проверьте права доступа API-ключа. (код ошибки: ${errorId})`;
      } else if (apiError.response?.status === 429) {
        userErrorMessage = `❌ Слишком много запросов. Пожалуйста, подождите немного. (код ошибки: ${errorId})`;
      } else if (apiError.response?.status >= 500) {
        userErrorMessage = `❌ Внутренняя ошибка сервера. Пожалуйста, повторите попытку позже. (код ошибки: ${errorId})`;
      } else if (apiError.response?.status === 422) {
        userErrorMessage = `❌ Некорректные параметры запроса. Проверьте формат и значения параметров. (код ошибки: ${errorId})`;
      } else if (apiError.response?.status === 400) {
        userErrorMessage = `❌ Неверный запрос. Проверьте параметры и попробуйте снова. (код ошибки: ${errorId})`;
      }

      await ctx.reply(userErrorMessage);
    }
    userStates.delete(ctx.from.id); // Clear state on error
    return;
  }

  // Validate that taskResult has an ID before proceeding
  if (!taskResult || !taskResult.id) {
    const errorId = 'TASK_ID_MISSING_' + Date.now();
    logger.logError('KIE_API', `Task creation response missing ID`, {
      errorId: errorId,
      userId: ctx.from.id,
      modelId: model.id,
      modelType: model.modelType,
      taskResult: taskResult,
      taskResultType: typeof taskResult
    });

    await ctx.reply(`❌ Ошибка: задача создана без идентификатора. Пожалуйста, попробуйте снова. (код ошибки: ${errorId})`);
    userStates.delete(ctx.from.id); // Clear state on error
    return;
  }

  // Save task to database with initial status and no payment deducted
  const task = {
    id: taskResult.id,
    userId: ctx.from.id,
    modelId: model.id,
    modelType: model.modelType,
    inputParams: userState.inputParams,
    createdAt: new Date().toISOString(),
    status: 'created',
    price: price,
    priceDeducted: false // Flag to track if price has been deducted
  };

  await db.saveTask(task);

  // Update stats
  systemStats.totalTasksCreated++;
  systemStats.activeUsers.add(ctx.from.id);

  await ctx.reply(`✅ Задача создана!\nID задачи: ${taskResult.id}\nОжидайте результат...`);

  // Clear user state
  userStates.delete(ctx.from.id);

  // Store chatId for use in async callback
  const chatId = ctx.chat.id;

  // Check task status and send result when ready (in a background process)
  setTimeout(async () => {
    try {
      const taskInfo = await kieApi.getTaskInfo(ctx.from.id, taskResult.id);

      if (taskInfo && taskInfo.state === 'success') {
        // Send the result to the user
        if (taskInfo.resultJson) {
          let resultData;
          try {
            resultData = JSON.parse(taskInfo.resultJson);
          } catch (parseError) {
            const errorId = 'PARSE_' + Date.now();
            logger.logError('RESULT_PARSE', `Failed to parse result JSON for task ${taskResult.id}`, {
              errorId: errorId,
              taskId: taskResult.id,
              userId: ctx.from.id,
              resultJson: taskInfo.resultJson,
              errorName: parseError.name,
              errorMessage: parseError.message,
              stack: parseError.stack
            });

            await bot.telegram.sendMessage(chatId, `⚠️ Не удалось обработать результат задачи. Пожалуйста, сообщите администратору код ошибки: ${errorId}`);
            return;
          }

          if (resultData.resultUrls && resultData.resultUrls.length > 0) {
            // Send photo to user with validation
            for (const imageUrl of resultData.resultUrls) {
              // Validate image URL
              if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
                const errorId = 'IMAGE_URL_' + Date.now();
                logger.logError('IMAGE_URL', `Invalid image URL received from API`, {
                  errorId: errorId,
                  taskId: taskResult.id,
                  userId: ctx.from.id,
                  imageUrl: imageUrl,
                  rawResult: taskInfo.resultJson
                });
                continue; // Skip invalid URLs
              }

              try {
                // Check if URL is accessible before sending
                await bot.telegram.sendPhoto(chatId, { url: imageUrl });
              } catch (sendError) {
                const errorId = 'SEND_' + Date.now();
                logger.logError('PHOTO_SEND', `Failed to send image to user ${ctx.from.id}`, {
                  errorId: errorId,
                  taskId: taskResult.id,
                  userId: ctx.from.id,
                  imageUrl: imageUrl,
                  errorName: sendError.name,
                  errorMessage: sendError.message,
                  stack: sendError.stack
                });

                // Try to send as document if photo fails
                try {
                  await bot.telegram.sendDocument(chatId, { url: imageUrl });
                } catch (docError) {
                  const docErrorId = 'DOC_' + Date.now();
                  logger.logError('DOC_SEND', `Failed to send image as document to user ${ctx.from.id}`, {
                    errorId: docErrorId,
                    taskId: taskResult.id,
                    userId: ctx.from.id,
                    imageUrl: imageUrl,
                    errorName: docError.message,
                    errorMessage: docError.message,
                    stack: docError.stack
                  });

                  await bot.telegram.sendMessage(chatId, `🖼️ Результат готов: ${escapeMarkdown(imageUrl)} (ошибка отправки: ${docErrorId})`);
                }
              }
            }

            // NOW deduct price from user balance after successful generation
            // Only for non-admin users
            const userIsAdmin = isAdmin(ctx.from.id);
            if (!userIsAdmin) {
              // Get current user balance to make sure we're using the right amount
              const currentUser = await db.getUser(ctx.from.id);
              if (currentUser && currentUser.balance >= price) {
                await db.updateUser(ctx.from.id, {
                  balance: currentUser.balance - price
                });

                // Update stats
                systemStats.totalTasksCompleted++;
                systemStats.totalRevenue += price;

                // Update task status in database
                await db.updateTask(taskResult.id, {
                  status: 'completed',
                  completedAt: new Date().toISOString(),
                  priceDeducted: true
                });

                // Send confirmation message about deduction
                await bot.telegram.sendMessage(chatId, `💰 С вашего баланса списано: ${formatPriceSafe(price)}`);
              } else {
                // Handle case where user doesn't have enough balance after task completion
                // (This shouldn't happen if initial check passed, but just in case)
                const errorId = 'BALANCE_' + Date.now();
                logger.logError('BALANCE', `Insufficient balance after task completion`, {
                  errorId: errorId,
                  taskId: taskResult.id,
                  userId: ctx.from.id,
                  required: price,
                  available: currentUser?.balance || 0
                });

                await bot.telegram.sendMessage(chatId, `⚠️ Ошибка списания средств. Пожалуйста, обратитесь к администратору. (код: ${errorId})`);
                // Mark task as completed without payment deduction
                await db.updateTask(taskResult.id, {
                  status: 'completed_no_payment',
                  completedAt: new Date().toISOString(),
                  priceDeducted: false,
                  errorId: errorId
                });
              }
            } else {
              // Update task status in database for admin (no deduction)
              await db.updateTask(taskResult.id, {
                status: 'completed',
                completedAt: new Date().toISOString()
              });

              // Update stats for admin (completed but no revenue)
              systemStats.totalTasksCompleted++;
            }
          } else {
            await bot.telegram.sendMessage(chatId, '⚠️ Результат задачи не содержит изображений.');
          }
        }
      } else if (taskInfo && taskInfo.state === 'fail') {
        const errorId = 'TASK_FAIL_' + Date.now();
        logger.logError('TASK_FAILED', `Task completed with failure state`, {
          errorId: errorId,
          taskId: taskResult.id,
          userId: ctx.from.id,
          failCode: taskInfo.failCode,
          failMsg: taskInfo.failMsg,
          state: taskInfo.state
        });

        await bot.telegram.sendMessage(chatId, `❌ Задача завершена с ошибкой: ${taskInfo.failMsg || 'Неизвестная ошибка'}. (код ошибки: ${errorId})`);
        // Update task status in database - no payment deduction for failed tasks
        await db.updateTask(taskResult.id, {
          status: 'failed',
          failMsg: taskInfo.failMsg,
          failCode: taskInfo.failCode,
          errorId: errorId,
          priceDeducted: false  // Ensure no payment was deducted
        });

        // Update stats for failed task
        systemStats.totalTasksFailed++;
      } else if (taskInfo) {
        await bot.telegram.sendMessage(chatId, `ℹ️ Статус задачи: ${taskInfo.state || 'unknown'}`);
      }
    } catch (checkError) {
      const errorId = 'CHECK_' + Date.now();
      logger.logError('TASK_CHECK', `Error checking task status for task ${taskResult.id}`, {
        errorId: errorId,
        taskId: taskResult.id,
        userId: ctx.from.id,
        errorName: checkError.name,
        errorMessage: checkError.message,
        stack: checkError.stack
      });

      await bot.telegram.sendMessage(chatId, `⚠️ Не удалось получить статус задачи. Попробуйте проверить позже с помощью /my_tasks (код ошибки: ${errorId})`);
    }
  }, 30000); // Check after 30 seconds
}

// Add Supabase storage functionality using the centralized DB module
function storeMediaToSupabase(buffer, fileName, mimeType) {
  // This function is called asynchronously in the photo handler, so we return a promise
  return new Promise(async (resolve, reject) => {
    try {
      // Use the centralized db module for media storage
      const storedUrl = await db.storeMedia(buffer, fileName, mimeType);
      resolve(storedUrl);
    } catch (error) {
      logger.logError('SUPABASE_MEDIA', `Failed to store media to Supabase via centralized DB`, {
        fileName: fileName,
        mimeType: mimeType,
        error: error.message
      });
      resolve(null); // Return null on error instead of rejecting
    }
  });
}

// Add media handling functionality
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const userState = userStates.get(userId);

  // Check if user is in balance recharge mode with pending payment
  const rechargeState = rechargeStates.get(userId);
  if (rechargeState && rechargeState.amount) {
    // This is a payment screenshot - handle it
    try {
      // Get the largest photo size
      const photos = ctx.message.photo;
      const photo = photos[photos.length - 1]; // Largest size

      // Get file info
      const fileInfo = await ctx.telegram.getFile(photo.file_id);

      // Check file size before downloading (Telegram has a 20MB limit for photos)
      if (fileInfo.file_size > 10 * 1024 * 1024) { // 10MB limit
        await ctx.reply(`❌ Размер изображения слишком большой. Пожалуйста, отправьте изображение размером до 10 МБ.`);
        return;
      }

      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;

      // Acknowledge receipt of payment screenshot
      await ctx.reply(`📸 Скриншот чека получен. Баланс автоматически пополнится после проверки платежа.\n\nСумма к пополнению: ${rechargeState.amount} ₽`);

      // Store the payment screenshot for admin review
      const paymentRecord = {
        id: `payment_${Date.now()}_${userId}`,
        userId: userId,
        amount: rechargeState.amount,
        timestamp: Date.now(),
        status: 'pending', // pending, approved, rejected
        fileUrl: fileUrl, // URL to the image
        adminReviewed: null, // Will be filled when admin reviews
        user: await db.getUser(userId) // Store user info for reference
      };

      paymentScreenshots.push(paymentRecord);

      // Log the payment screenshot for admin verification
      logger.logBot(`Payment screenshot received from user ${userId} for amount: ${rechargeState.amount} RUB`, {
        paymentId: paymentRecord.id,
        userId: userId,
        amount: rechargeState.amount,
        timestamp: rechargeState.timestamp,
        fileUrl: fileUrl
      });

      // Notify admin about new pending payment (if there are any admins)
      const adminIds = process.env.ADMIN_IDS?.split(',').map(id => parseInt(id.trim())) || [];
      for (const adminId of adminIds) {
        try {
          await ctx.telegram.sendMessage(
            adminId,
            `🔔 *НОВЫЙ ПЛАТЕЖ ЖДЕТ ПРОВЕРКИ*\n\n` +
            `Пользователь: ${userId}\n` +
            `Сумма: ${rechargeState.amount} ₽\n` +
            `ID: ${paymentRecord.id}\n` +
            `Используйте команду /payments для просмотра всех ожидающих платежей.`,
            { parse_mode: 'Markdown' }
          );
        } catch (notifyErr) {
          logger.logError(notifyErr, `Failed to notify admin ${adminId} about new payment`);
        }
      }

      // Clear recharge state after receiving screenshot
      rechargeStates.delete(userId);
      return;
    } catch (error) {
      logger.logError(error, `Error handling payment screenshot from user ${userId}`);
      await ctx.reply(`❌ Ошибка обработки скриншота чека: ${error.message}`);
      return;
    }
  }

  // Check if user is in the state where we expect image input
  if (userState && userState.mode === 'model_params' && userState.step === 'ask_for_image') {
    try {
      // Get the largest photo size
      const photos = ctx.message.photo;
      const photo = photos[photos.length - 1]; // Largest size

      // Get file info
      const fileInfo = await ctx.telegram.getFile(photo.file_id);

      // Check file size before downloading (Telegram has a 20MB limit for photos)
      if (fileInfo.file_size > 10 * 1024 * 1024) { // 10MB limit
        await ctx.reply(`❌ Размер изображения слишком большой. Пожалуйста, отправьте изображение размером до 10 МБ.`);
        return;
      }

      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;

      // Check if Supabase is configured
      if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        // Store image in Supabase
        try {
          const response = await fetch(fileUrl);
          const buffer = await response.buffer();

          // Validate image format
          const fileType = await import('file-type');
          const typeInfo = await fileType.fromBuffer(buffer);
          if (!typeInfo || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(typeInfo.mime)) {
            await ctx.reply(`❌ Неподдерживаемый формат изображения. Поддерживаемые форматы: JPG, PNG, WEBP, GIF.`);
            return;
          }

          const fileName = `images/${userId}_${Date.now()}.${typeInfo.ext}`;
          const storedUrl = await storeMediaToSupabase(buffer, fileName, typeInfo.mime);

          if (storedUrl) {
            // Add image to input parameters, considering the model type
            userState.inputParams = userState.inputParams || {};

            // Check if it's a Flux model which uses input_urls instead of image_input
            const model = await db.getModel(userState.modelId);
            if (model && model.modelType.includes('flux-2')) {
              if (!userState.inputParams.input_urls) {
                userState.inputParams.input_urls = [];
              }
              userState.inputParams.input_urls.push(storedUrl);
            } else {
              if (!userState.inputParams.image_input) {
                userState.inputParams.image_input = [];
              }
              userState.inputParams.image_input.push(storedUrl);
            }

            await ctx.reply(`🖼️✅ Изображение загружено и добавлено к параметрам.\n\nТеперь введите *текст запроса* (prompt) или нажмите "далее", чтобы продолжить:`);

            // Update state step to indicate we're now waiting for text prompt
            userState.step = 'waiting_prompt_after_image';
            userStates.set(userId, userState);
            return;
          }
        } catch (supabaseError) {
          logger.logError(supabaseError, `Supabase upload failed for user ${userId}`);
          // Fall back to using Telegram URL
        }
      }

      // If Supabase isn't available or failed, use direct Telegram URL
      userState.inputParams = userState.inputParams || {};

      // Check model type for parameter naming
      const model = await db.getModel(userState.modelId);
      if (model && model.modelType.includes('flux-2')) {
        if (!userState.inputParams.input_urls) {
          userState.inputParams.input_urls = [];
        }
        userState.inputParams.input_urls.push(fileUrl);
      } else {
        if (!userState.inputParams.image_input) {
          userState.inputParams.image_input = [];
        }
        userState.inputParams.image_input.push(fileUrl);
      }

      await ctx.reply(`🖼️✅ Изображение добавлено к параметрам.\n\nТеперь введите *текст запроса* (prompt) или нажмите "далее", чтобы продолжить:`);

      // Update state step to indicate we're now waiting for text prompt
      userState.step = 'waiting_prompt_after_image';
      userStates.set(userId, userState);
    } catch (error) {
      logger.logError(error, `Error handling photo from user ${userId}`);
      await ctx.reply(`❌ Ошибка при обработке изображения. Попробуйте снова.`);
    }
  } else if (userState && userState.mode === 'model_params') {
    // User is in model parameters mode but not in image expectation mode
    const model = await db.getModel(userState.modelId);
    if (model) {
      // Check if this model actually requires an image
      const requiresImageInput = model.input_schema.properties.image_input ||
                                model.input_schema.properties.input_urls ||
                                model.input_schema.properties.image_urls ||
                                model.modelType.includes('image-to-image') ||
                                model.modelType.includes('img2img') ||
                                model.modelType.includes('-to-image') && model.modelType.includes('image-');

      if (requiresImageInput) {
        await ctx.reply(`🖼️⚠️ Для этой модели («${model.name}») требуется отправить фото.\n\nПожалуйста, сначала выберите модель в меню, затем отправьте фото.`);
      } else {
        await ctx.reply(`🖼️ℹ️ Текущая модель («${model.name}») предназначена для генерации из текста в изображение.\n\nПожалуйста, введите текст запроса (prompt) для генерации.`);
      }
    } else {
      await ctx.reply(`🖼️❌ Невозможно определить текущую модель. Пожалуйста, начните процесс заново через меню.`);
    }
  } else {
    await ctx.reply(`🖼️ℹ️ Чтобы отправить фото для генерации, сначала выберите модель в меню.\n\nСейчас вы не в режиме ожидания изображения.`);
  }
});

// Also handle documents if needed
bot.on('document', async (ctx) => {
  const userId = ctx.from.id;
  const userState = userStates.get(userId);

  try {
    // Check if document is an image
    const fileExtension = ctx.message.document.file_name.split('.').pop().toLowerCase();
    const allowedExtensions = ['jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp'];

    if (allowedExtensions.includes(fileExtension) &&
        userState && userState.mode === 'model_params' && userState.step === 'ask_for_image') {

      // Check file size (limit to 10MB)
      if (ctx.message.document.file_size > 10 * 1024 * 1024) {
        await ctx.reply(`❌ Размер файла слишком большой. Пожалуйста, отправьте изображение размером до 10 МБ.`);
        return;
      }

      const fileInfo = await ctx.telegram.getFile(ctx.message.document.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;

      // Check if Supabase is configured
      if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        // Store image in Supabase
        try {
          const response = await fetch(fileUrl);
          const buffer = await response.buffer();

          // Validate image format using file-type library
          const fileType = await import('file-type');
          const typeInfo = await fileType.fromBuffer(buffer);
          if (!typeInfo || !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'].includes(typeInfo.mime)) {
            await ctx.reply(`❌ Неподдерживаемый формат изображения. Поддерживаемые форматы: JPG, PNG, WEBP, GIF, BMP.`);
            return;
          }

          const fileName = `images/${userId}_${Date.now()}.${typeInfo.ext}`;
          const storedUrl = await storeMediaToSupabase(buffer, fileName, typeInfo.mime);

          if (storedUrl) {
            // Add image to input parameters
            userState.inputParams = userState.inputParams || {};
            if (!userState.inputParams.image_input) {
              userState.inputParams.image_input = [];
            }
            userState.inputParams.image_input.push(storedUrl);

            await ctx.reply(`✅ Изображение загружено и добавлено к параметрам.\n\nТеперь введите "далее", чтобы продолжить:`);
            return;
          }
        } catch (supabaseError) {
          logger.logError(supabaseError, `Supabase upload failed for user ${userId}`);
          // Fall back to using Telegram URL
        }
      }

      // Validate document MIME type before using
      const fileType = await import('file-type');
      const response = await fetch(fileUrl);
      const buffer = await response.buffer();
      const typeInfo = await fileType.fromBuffer(buffer);

      if (!typeInfo || !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'].includes(typeInfo.mime)) {
        await ctx.reply(`❌ Неподдерживаемый формат изображения. Поддерживаемые форматы: JPG, PNG, WEBP, GIF, BMP.`);
        return;
      }

      // If Supabase isn't available or failed, use direct Telegram URL
      userState.inputParams = userState.inputParams || {};
      if (!userState.inputParams.image_input) {
        userState.inputParams.image_input = [];
      }
      userState.inputParams.image_input.push(fileUrl);

      await ctx.reply(`✅ Изображение добавлено к параметрам.\n\nТеперь введите "далее", чтобы продолжить:`);
    } else {
      await ctx.reply('🖼️ Пожалуйста, отправляйте изображения для использования в генерации. Или начните процесс создания задачи через меню.');
    }
  } catch (error) {
    logger.logError(error, `Error handling document from user ${userId}`);
    await ctx.reply(`❌ Ошибка при обработке изображения. Попробуйте снова.`);
  }
});

// Start the bot
startBot().catch(error => {
  logger.logError(error, 'Failed to start bot');
  process.exit(1);
});