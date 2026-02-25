import React from "react";
import Routes from "./routes";
import "react-toastify/dist/ReactToastify.css";

// NOTE: The app already provides a single ThemeProvider (DarkMode context) in /routes.
// Keeping a second ThemeProvider here caused "split theme" issues (part of the UI in dark,
// part in light) due to nested MUI themes.
const App = () => {
  return <Routes />;
};

export default App;
