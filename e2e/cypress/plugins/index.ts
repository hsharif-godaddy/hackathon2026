const ssoPlugin = (on: Cypress.PluginEvents, _config: Cypress.PluginConfigOptions) => {
    on('task', require('@gd-cypress/auth').task);
};