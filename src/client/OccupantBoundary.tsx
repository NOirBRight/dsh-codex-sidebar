import { Component, type ErrorInfo, type ReactNode } from 'react'
import { retainDetailsOccupantAfterRenderError } from './occupant-hold.ts'

type OccupantBoundaryProps = {
  children: ReactNode
  label: string
  retryLabel: string
  onRetry?: () => void
}

type OccupantBoundaryState = {
  message: string | null
}

/** Catch tool-pane crashes so the details slot does not abdicate to DetailsPanel. */
export class OccupantBoundary extends Component<OccupantBoundaryProps, OccupantBoundaryState> {
  override state: OccupantBoundaryState = { message: null }

  static getDerivedStateFromError(error: unknown): OccupantBoundaryState {
    return { message: retainDetailsOccupantAfterRenderError(error).message }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[dsh-codex-sidebar] details occupant held after render error', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.message !== null) {
      return (
        <div className="dcs-root dcs-occupant-error">
          <p>{this.props.label}</p>
          <pre>{this.state.message}</pre>
          <button
            type="button"
            onClick={() => {
              this.setState({ message: null })
              this.props.onRetry?.()
            }}
          >
            {this.props.retryLabel}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
