import React from "react";
import { Typography, Paper, Button, Box } from "@material-ui/core";
import { Error as ErrorIcon } from "@material-ui/icons";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({
      error,
      errorInfo
    });

    // Aquí podrías enviar el error a un servicio de tracking como Sentry
    // if (window.Sentry) {
    //   window.Sentry.captureException(error);
    // }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      return (
        <Box
          display="flex"
          justifyContent="center"
          alignItems="center"
          minHeight="100vh"
          bgcolor="#f5f5f5"
          p={3}
        >
          <Paper
            elevation={3}
            style={{
              padding: "40px",
              maxWidth: "600px",
              textAlign: "center"
            }}
          >
            <ErrorIcon
              style={{
                fontSize: 80,
                color: "#f44336",
                marginBottom: 20
              }}
            />
            <Typography variant="h4" gutterBottom color="error">
              ¡Oops! Algo salió mal
            </Typography>
            <Typography variant="body1" color="textSecondary" paragraph>
              Lo sentimos, ha ocurrido un error inesperado. Por favor, intenta
              recargar la página o vuelve al inicio.
            </Typography>

            {process.env.NODE_ENV === "development" && this.state.error && (
              <Paper
                variant="outlined"
                style={{
                  padding: "20px",
                  marginTop: "20px",
                  textAlign: "left",
                  backgroundColor: "#fff3e0",
                  overflow: "auto",
                  maxHeight: "300px"
                }}
              >
                <Typography
                  variant="subtitle2"
                  color="error"
                  style={{ marginBottom: 10 }}
                >
                  Error Details (Development Only):
                </Typography>
                <Typography
                  variant="body2"
                  component="pre"
                  style={{
                    fontSize: "12px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word"
                  }}
                >
                  {this.state.error.toString()}
                  {"\n\n"}
                  {this.state.errorInfo?.componentStack}
                </Typography>
              </Paper>
            )}

            <Box mt={3} display="flex" gap={2} justifyContent="center">
              <Button
                variant="contained"
                color="primary"
                onClick={() => window.location.reload()}
              >
                Recargar Página
              </Button>
              <Button
                variant="outlined"
                color="primary"
                onClick={this.handleReset}
              >
                Volver al Inicio
              </Button>
            </Box>
          </Paper>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
