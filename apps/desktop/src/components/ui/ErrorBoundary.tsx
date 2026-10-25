import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback: ReactNode;
  resetKey?: string | number;
};
type State = { failed: boolean; resetKey?: string | number };

/** UI fallbacks must work without a router or a matching router test mock. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  static getDerivedStateFromProps(props: Props, state: State) {
    return props.resetKey !== state.resetKey
      ? { failed: false, resetKey: props.resetKey }
      : null;
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
