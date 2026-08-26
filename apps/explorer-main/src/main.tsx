import { render } from "solid-js/web";
import App from "./App";
import "../../../packages/ui/src/styles.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root mount element");
render(() => <App />, root);
