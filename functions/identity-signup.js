const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { faunaFetch } = require('./utils/fauna');

exports.handler = async (event) => {
    const { user } = JSON.parse(event.body);

    // create customer in Stripe
    const customer = await stripe.customers.create({ email: user.email });

    // subscribe the new customer to the free plan
    const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: process.env.STRIPE_DEFAULT_PRICE_PLAN }],
        expand: ['items.data.price.product'],
    });

    const plan = subscription.items.data[0].plan.nickname;
    const role = plan.split(' ')[0].toLowerCase();

    // store the Netlify and Stripe IDs in Fauna
    await faunaFetch({
        query: `
            mutation ($netlifyID: ID!, $stripeID: ID!, $priceID: String, $planID: String, $planName: String) {
                createUser(data: { netlifyID: $netlifyID, stripeID: $stripeID, priceID: $priceID, planID: $planID, planName: $planName }) {
                    netlifyID
                    stripeID
                    priceID
                    planID
                    planName
                }
            }
        `,
        variables: {
            netlifyID: user.id,
            stripeID: customer.id,
            priceID: subscription.items.data[0].price.id,
            planID: subscription.items.data[0].price.product.id,
            planName: role,
        },
    });

    return {
        statusCode: 200,
        body: JSON.stringify({
            app_metadata: {
                roles: [role],
            },
        }),
    };
};