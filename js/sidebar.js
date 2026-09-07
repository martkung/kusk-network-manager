async function loadSidebar(){

    const sidebarContainer =
    document.getElementById(
        "sidebar-container"
    );

    if(!sidebarContainer){
        return;
    }

    let sidebarPath = "";

    if(
        window.location.pathname.includes("/pages/")
    ){

        sidebarPath =
        "../components/sidebar.html";

    }else{

        sidebarPath =
        "components/sidebar.html";

    }

    const response =
    await fetch(
        sidebarPath
    );

    sidebarContainer.innerHTML =
    await response.text();

    initMobileMenu();
    initLogout();

}

async function loadModal(){

    const modalContainer =
    document.getElementById(
        "modal-container"
    );

    if(!modalContainer){
        return;
    }

    let modalPath = "";

    if(
        window.location.pathname.includes("/pages/")
    ){

        modalPath =
        "../components/device-modal.html";

    }else{

        modalPath =
        "components/device-modal.html";

    }

    const response =
    await fetch(
        modalPath
    );

    modalContainer.innerHTML =
    await response.text();

}

document.addEventListener(
    "DOMContentLoaded",
    async ()=>{

        await loadSidebar();
        await loadModal();
        await loadUserInfo();

    }
);

/* ==========================
   MOBILE SIDEBAR
========================== */

function initMobileMenu(){

    const menuBtn =
    document.getElementById(
        "menuBtn"
    );

    const sidebar =
    document.getElementById(
        "sidebar"
    );

    if(
        !menuBtn ||
        !sidebar
    ){
        return;
    }

    menuBtn.onclick =
    function(e){

        e.stopPropagation();

        sidebar.classList.toggle(
            "show"
        );

    };

    document.addEventListener(
        "click",
        function(e){

            if(
                !sidebar.contains(
                    e.target
                )
            ){

                sidebar.classList.remove(
                    "show"
                );

            }

        }
    );

}

async function loadUserInfo(){

    try{

        const {
         auth
            } =
            await import(
             "/js/firebase-config.js"
            );

        const {
          onAuthStateChanged
            } =
            await import(
              "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js"
            );

        const emailBox =
        document.getElementById(
        "userEmail"
        );

        onAuthStateChanged(
        auth,
        (user)=>{

        if(
            user &&
            emailBox
        ){

            emailBox.textContent =
            user.email;

        }else if(emailBox){

            emailBox.textContent =
            "Not Logged In";

        }

    }
);

    }
    catch(error){

        console.error(
            "Load User Error:",
            error
        );

    }

}


/* ==========================
   FIREBASE LOGOUT
========================== */

function initLogout(){

    const logoutBtn =
    document.getElementById(
        "logoutBtn"
    );

    if(!logoutBtn){
        return;
    }

    logoutBtn.onclick =
    async function(e){

        e.preventDefault();

        try{

            const {
                auth
            } =
            await import(
            "/js/firebase-config.js"
            );

            const {
                signOut
            } =
            await import(
            "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js"
            );

            await signOut(
                auth
            );

            window.location.replace(
                "/login.html"
            );

        }
        catch(error){

            console.error(
                "Logout Error:",
                error
            );

            alert(
                "Logout Failed"
            );

        }

    };

}