import { render } from "solid-js/web";
import App from "./App";
import "./component-details.css";
import "./resource-first.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root mount element");
render(() => <App />, root);
