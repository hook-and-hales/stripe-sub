const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = require('node-fetch');
const { faunaFetch } = require('./utils/fauna');

exports.handler = async ({ body, headers }, context) => {
    try {
        // make sure this event was sent legitimately
        const stripeEvent = stripe.webhooks.constructEvent(
            body,
            headers['stripe-signature'],
            process.env.STRIPE_WEBHOOK_SECRET,
        );

        // bail if this is not a subscription update event
        if (stripeEvent.type !== 'customer.subscription.updated') return;

        const subscription = stripeEvent.data.object;

        const result = await faunaFetch({
            query: `
                query ($stripeID: ID!) {
                  getUserByStripeID(stripeID: $stripeID) {
                    _id
                    netlifyID
                  }
                }
              `,
            variables: {
                stripeID: subscription.customer,
            },
        });

        const netlifyID = result.data.getUserByStripeID.netlifyID;
        const faunaID = result.data.getUserByStripeID._id;

        // take the first word of the plan name and use it as the role
        const plan = subscription.items.data[0].plan.nickname;
        const role = plan.split(' ')[0].toLowerCase();

        // first send to fauna to update the user role
        await faunaFetch({
            query: `
            mutation ($faunaID: ID, $netlifyID: ID!, $stripeID: ID!, $priceID: String, $planID: String, $planName: String) {
                updateUser(id: $faunaID, data: { netlifyID: $netlifyID, stripeID: $stripeID, priceID: $priceID, planID: $planID, planName: $planName }) {
                    netlifyID
                    stripeID
                    priceID
                    planID
                    planName
                }
            }
        `,
            variables: {
                netlifyID: netlifyID,
                stripeID: subscription.customer,
                priceID: subscription.items.data[0].price.id,
                planID: subscription.items.data[0].price.product.id,
                planName: role,
                faunaID: faunaID
            },
        });

        // then send a call to the Netlify Identity admin API to update the user role
        const { identity } = context.clientContext;
        await fetch(`${identity.url}/admin/users/${netlifyID}`, {
            method: 'PUT',
            headers: {
                // note that this is a special admin token for the Identity API
                Authorization: `Bearer ${identity.token}`,
            },
            body: JSON.stringify({
                app_metadata: {
                    roles: [role],
                },
            }),
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ recieved: true }),
        };
    } catch (err) {
        return {
            statusCode: 400,
            body: `Webhook Error: ${err.message}`,
        };
    }
};