import React, { createContext, useState, useContext, useMemo } from "react";
import PropTypes from "prop-types";
import { createMuiTheme, ThemeProvider as MUIThemeProvider } from "@material-ui/core/styles";
import { CssBaseline } from "@material-ui/core";

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [darkMode, setDarkMode] = useState(false);

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
            main: "#ef4444" // autos accent
          },
          secondary: {
            main: "#2576d2"
          },
          background: darkMode
            ? {
                default: "#0b1220",
                paper: "#0f172a"
              }
            : {
                default: "#f5f7fb",
                paper: "#ffffff"
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
          MuiPaper: {
            rounded: {
              borderRadius: 12
            }
          },
          MuiButton: {
            root: {
              borderRadius: 12
            },
            containedPrimary: {
              boxShadow: "none"
            }
          },
          MuiTableCell: {
            head: {
              fontWeight: 700
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
