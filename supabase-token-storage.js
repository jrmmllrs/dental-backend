// supabase-token-storage.js
// Token storage using Supabase (replacement for file storage)

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // Use service key for server-side
);

/**
 * Load shared calendar tokens from Supabase
 * @returns {Promise<Object|null>} Token data or null
 */
async function loadSharedCalendarTokens() {
  try {
    const { data, error } = await supabase
      .from('calendar_tokens')
      .select('*')
      .eq('type', 'shared_calendar')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows found - this is OK on first run
        console.log('⚠️  No tokens found in database');
        return null;
      }
      throw error;
    }

    if (data && data.tokens) {
      console.log(`📂 Loaded tokens for ${data.user_email}`);
      return {
        tokens: data.tokens,
        userEmail: data.user_email,
        savedAt: data.saved_at
      };
    }

    return null;
  } catch (err) {
    console.error('❌ Error loading tokens from Supabase:', err.message);
    return null;
  }
}

/**
 * Save shared calendar tokens to Supabase
 * @param {Object} tokens - OAuth tokens
 * @param {string} userEmail - Admin email
 * @returns {Promise<boolean>} Success status
 */
async function saveSharedCalendarTokens(tokens, userEmail) {
  try {
    const { data, error } = await supabase
      .from('calendar_tokens')
      .upsert({
        type: 'shared_calendar',
        tokens: tokens,
        user_email: userEmail,
        saved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'type'
      })
      .select();

    if (error) throw error;

    console.log(`✅ Tokens saved to Supabase for ${userEmail}`);
    return true;
  } catch (err) {
    console.error('❌ Error saving tokens to Supabase:', err.message);
    return false;
  }
}

/**
 * Delete tokens from Supabase (for logout/cleanup)
 * @returns {Promise<boolean>}
 */
async function deleteSharedCalendarTokens() {
  try {
    const { error } = await supabase
      .from('calendar_tokens')
      .delete()
      .eq('type', 'shared_calendar');

    if (error) throw error;

    console.log('🗑️  Tokens deleted from Supabase');
    return true;
  } catch (err) {
    console.error('❌ Error deleting tokens:', err.message);
    return false;
  }
}

/**
 * Get all tokens (admin use - debugging)
 * @returns {Promise<Array>}
 */
async function getAllTokens() {
  try {
    const { data, error } = await supabase
      .from('calendar_tokens')
      .select('*');

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('❌ Error fetching all tokens:', err.message);
    return [];
  }
}

module.exports = {
  loadSharedCalendarTokens,
  saveSharedCalendarTokens,
  deleteSharedCalendarTokens,
  getAllTokens,
  supabase // Export for direct access if needed
};