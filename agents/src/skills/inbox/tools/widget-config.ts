export interface WidgetConfig {
  _support: {
    account: string;
    ui: {
      widget: {
        icon: string;
        color: string;
        position: string;
        label?: {
          text: string;
        };
      };
    };
  };
}
