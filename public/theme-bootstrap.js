try {
	if (localStorage.getItem("pixel-spell-theme") === "dark") {
		document.documentElement.classList.add("dark");
	}
} catch {
	// Ignore storage restrictions.
}
