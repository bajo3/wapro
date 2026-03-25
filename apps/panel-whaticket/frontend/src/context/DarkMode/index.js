import React, { createContext, useState, useContext, useMemo, useEffect } from "react";
import PropTypes from "prop-types";
import { createMuiTheme, ThemeProvider as MUIThemeProvider } from "@material-ui/core/styles";
import { CssBaseline } from "@material-ui/core";

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem("panel:darkMode");
      if (saved === "true") return true;
      if (saved === "false") return false;
    } catch (e) {
      // no-op
    }
    return true;
  });

  useEffect(() => {
    try {
      localStorage.setItem("panel:darkMode", String(darkMode));
    } catch (e) {
      // no-op
    }

    const mode = darkMode ? "dark" : "light";
    document.documentElement.setAttribute("data-panel-theme", mode);
    document.body.setAttribute("data-panel-theme", mode);
  }, [darkMode]);

  const toggleTheme = () => {
    setDarkMode((prevMode) => !prevMode);
  };

  const theme = useMemo(
    () =>
      createMuiTheme({
        // A more opinionated theme for a cleaner, more consistent UI.
        // We keep it compatible with Material UI v4.
        palette: {
          type: darkMode ? "dark" : "light",
          primary: {
            main: "#f59e0b"
          },
          secondary: {
            main: "#38bdf8"
          },
          background: darkMode
            ? {
                default: "#0b1120",
                paper: "#111827"
              }
            : {
                default: "#f3f4f6",
                paper: "#ffffff"
              },
          text: darkMode
            ? {
                primary: "#e5e7eb",
                secondary: "#94a3b8"
              }
            : {
                primary: "#0f172a",
                secondary: "#475569"
              }
        },

        typography: {
          fontFamily:
            "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          button: {
            textTransform: "none",
            fontWeight: 600
          }
        },

        shape: {
          borderRadius: 12
        },

        overrides: {
          MuiCssBaseline: {
            "@global": {
              body: {
                backgroundColor: darkMode ? "#0b1120" : "#f3f4f6",
                backgroundImage: darkMode
                  ? "radial-gradient(circle at top, rgba(245, 158, 11, 0.08), transparent 35%)"
                  : "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
                transition: "background-color 180ms ease, color 180ms ease"
              }
            }
          },
          MuiPaper: {
            root: {
              backgroundImage: "none",
              border: darkMode ? "1px solid rgba(148, 163, 184, 0.12)" : "1px solid rgba(15, 23, 42, 0.06)",
              boxShadow: darkMode
                ? "0 12px 36px rgba(2, 6, 23, 0.24)"
                : "0 8px 24px rgba(15, 23, 42, 0.06)"
            },
            rounded: {
              borderRadius: 14
            }
          },
          MuiAppBar: {
            colorPrimary: {
              backgroundColor: darkMode ? "rgba(15, 23, 42, 0.92)" : "rgba(255,255,255,0.92)",
              color: darkMode ? "#e5e7eb" : "#0f172a",
              backdropFilter: "blur(14px)",
              boxShadow: darkMode
                ? "0 10px 30px rgba(2, 6, 23, 0.3)"
                : "0 8px 24px rgba(15, 23, 42, 0.08)"
            }
          },
          MuiButton: {
            root: {
              borderRadius: 12,
              textTransform: "none"
            },
            containedPrimary: {
              boxShadow: "none"
            }
          },
          MuiInputBase: {
            root: {
              borderRadius: 12
            }
          },
          MuiTableCell: {
            head: {
              fontWeight: 700
            }
          },
          MuiDrawer: {
            paper: {
              backgroundColor: darkMode ? "#0f172a" : "#ffffff",
              borderRight: darkMode ? "1px solid rgba(148, 163, 184, 0.12)" : "1px solid rgba(15, 23, 42, 0.06)"
            }
          }
        }
      }),
    [darkMode]
  );

  const contextValue = useMemo(() => ({ darkMode, toggleTheme }), [darkMode]);

  return (
    <ThemeContext.Provider value={contextValue}>
      <MUIThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MUIThemeProvider>
    </ThemeContext.Provider>
  );
};
ThemeProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export const useThemeContext = () => useContext(ThemeContext);
