// =============================================
// CREATE CHECKOUT - Stripe Checkout for quote deposit
// =============================================

const Stripe = require('stripe');
const { getSupabase, success, error, handleCors, parseBody, validateSession } = require('./utils');

exports.handler = async (event) => {
  const corsResponse = handleCors(event);
  if (corsResponse) return corsResponse;
  
  if (event.httpMethod !== 'POST') {
    return error('Method not allowed', 405);
  }
  
  const customer = await validateSession(event);
  if (!customer) {
    return error('Unauthorized', 401);
  }
  
  const { quote_id, selected_options } = parseBody(event);
  
  if (!quote_id) {
    return error('Quote ID required');
  }
  
  const supabase = getSupabase();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  
  try {
    // Get quote
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('*')
      .eq('id', quote_id)
      .eq('customer_id', customer.id)
      .single();
    
    if (quoteError || !quote) {
      return error('Quote not found', 404);
    }
    
    // Check quote is valid for acceptance
    if (!['sent', 'viewed'].includes(quote.status)) {
      return error('Quote cannot be accepted');
    }
    
    if (quote.expires_at && new Date(quote.expires_at) < new Date()) {
      return error('Quote has expired');
    }
    
    // Update selected options if provided
    if (selected_options && selected_options.length > 0) {
      // Reset all optional items
      await supabase
        .from('quote_line_items')
        .update({ is_selected: false })
        .eq('quote_id', quote_id)
        .eq('is_optional', true);
      
      // Set selected ones
      await supabase
        .from('quote_line_items')
        .update({ is_selected: true })
        .eq('quote_id', quote_id)
        .in('id', selected_options);
    }
    
    // Recalculate quote totals
    const { data: lineItems } = await supabase
      .from('quote_line_items')
      .select('*')
      .eq('quote_id', quote_id);
    
    let subtotal = 0;
    lineItems.forEach(item => {
      if (!item.is_optional || item.is_selected) {
        subtotal += parseFloat(item.line_total || 0);
      }
    });
    
    const taxAmount = subtotal * parseFloat(quote.tax_rate || 0);
    const total = subtotal + taxAmount;
    
    // Calculate deposit
    let depositAmount;
    if (quote.deposit_type === 'percentage') {
      depositAmount = total * (parseFloat(quote.deposit_value) / 100);
    } else {
      depositAmount = parseFloat(quote.deposit_value);
    }
    
    // Ensure minimum $0.50 for Stripe
    depositAmount = Math.max(depositAmount, 0.50);
    
    // Create Stripe Checkout session
    const siteUrl = process.env.SITE_URL || 'https://homesteadcabinetdesign.com';
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: customer.email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Deposit for ${quote.title}`,
              description: `Quote ${quote.quote_number}`,
            },
            unit_amount: Math.round(depositAmount * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${siteUrl}/portal/payment-success.html?quote_id=${quote_id}`,
      cancel_url: `${siteUrl}/portal/quote.html?id=${quote_id}&cancelled=true`,
      metadata: {
        quote_id,
        customer_id: customer.id,
        payment_type: 'deposit',
      },
    });
    
    return success({ checkout_url: session.url });
    
  } catch (err) {
    console.error('Checkout error:', err);
    return error('Failed to create checkout session', 500);
  }
};
