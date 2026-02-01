import React from "react";
import { BrowserRouter } from "react-router-dom";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { initPageTransitions } from "./utils/pageTransition";

initPageTransitions();


ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>    
  </React.StrictMode>
);
