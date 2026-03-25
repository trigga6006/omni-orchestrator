import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackClassName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className={`flex flex-col items-center justify-center gap-3 p-6 text-center ${this.props.fallbackClassName ?? "flex-1"}`}
        >
          <div className="w-10 h-10 rounded-xl bg-rose/10 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-rose" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-foreground/80">
              Something went wrong
            </p>
            <p className="text-[11px] text-muted-foreground mt-1 max-w-xs">
              {this.state.error?.message ?? "An unexpected error occurred"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] mt-1"
            onClick={this.handleReset}
          >
            <RotateCcw className="w-3 h-3 mr-1.5" />
            Retry
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
