import React, { lazy } from "react";
import { BrowserRouter, Switch } from "react-router-dom";
import { Redirect } from "react-router-dom";
import { ToastContainer } from "react-toastify";

import LoggedInLayout from "../layout";
// Route-level code splitting (lazy pages) to reduce initial bundle size.
// NOTE: Our custom <Route /> wrapper handles <Suspense /> fallback.
const Dashboard = lazy(() => import("../pages/Dashboard/"));
const Tickets = lazy(() => import("../pages/Tickets/"));
const Signup = lazy(() => import("../pages/Signup/"));
const Login = lazy(() => import("../pages/Login/"));
const Connections = lazy(() => import("../pages/Connections/"));
const Settings = lazy(() => import("../pages/Settings/"));
const Users = lazy(() => import("../pages/Users"));
const Contacts = lazy(() => import("../pages/Contacts/"));
const Demands = lazy(() => import("../pages/Contacts/Demands"));
const QuickAnswers = lazy(() => import("../pages/QuickAnswers/"));
const Bot = lazy(() => import("../pages/Bot/"));
const BotLearning = lazy(() => import("../pages/BotLearning/"));
const Queues = lazy(() => import("../pages/Queues/"));
const Campaigns = lazy(() => import("../pages/Campaigns"));
const Quotations = lazy(() => import("../pages/Quotations"));
const Pipeline = lazy(() => import("../pages/Pipeline"));
import { AuthProvider } from "../context/Auth/AuthContext";
import { WhatsAppsProvider } from "../context/WhatsApp/WhatsAppsContext";
import { ThemeProvider } from "../context/DarkMode";
import Route from "./Route";

const Routes = () => {
  const TrainingRedirect = () => <Redirect to="/bot?tab=training" />;

  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <Switch>
            <Route exact path="/login" component={Login} />
            <Route exact path="/signup" component={Signup} />
            <WhatsAppsProvider>
              <LoggedInLayout>
                <Route exact path="/" component={Dashboard} isPrivate />
                <Route exact path="/tickets/:ticketId?" component={Tickets} isPrivate />
                <Route exact path="/pipeline" component={Pipeline} isPrivate />
                <Route exact path="/connections" component={Connections} isPrivate />
                <Route exact path="/contacts" component={Contacts} isPrivate />
                <Route exact path="/contacts/demands" component={Demands} isPrivate />
                <Route exact path="/users" component={Users} isPrivate />
                <Route exact path="/quickAnswers" component={QuickAnswers} isPrivate />
                <Route exact path="/bot" component={Bot} isPrivate />
                <Route exact path="/bot-learning" component={BotLearning} isPrivate />
                <Route exact path="/campaigns" component={Campaigns} isPrivate />
                {/* Backwards compatibility: /training now lives inside /bot as a tab */}
                <Route exact path="/training" component={TrainingRedirect} isPrivate />
                <Route exact path="/quotations" component={Quotations} isPrivate />
                <Route exact path="/Settings" component={Settings} isPrivate />
                <Route exact path="/Queues" component={Queues} isPrivate />
              </LoggedInLayout>
            </WhatsAppsProvider>
          </Switch>
          <ToastContainer autoClose={3000} />
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default Routes;
