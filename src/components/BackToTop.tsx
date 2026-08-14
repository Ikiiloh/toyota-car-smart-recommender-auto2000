"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { ArrowUp } from "lucide-react";
import { usePathname } from "next/navigation";

const BackToTopButton = () => {
  const [isVisible, setIsVisible] = useState(false);
  const pathname = usePathname();

  const toggleVisibility = () => {
    if (window.scrollY > 150) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  };

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  useEffect(() => {
    window.addEventListener("scroll", toggleVisibility);
    return () => {
      window.removeEventListener("scroll", toggleVisibility);
    };
  }, []);

  // Hide on Mobil AI page
  if (pathname === "/rekomendasi-ai") return null;

  return (
    <div className="fixed bottom-14 right-4">
      {isVisible && (
        <Button
          onClick={scrollToTop}
          variant="outline"
          className="backdrop-blur-lg bg-background/30 rounded-xl py-5 mb-10 px-3 shadow-lg size-lg"
        >
          <ArrowUp className="text-red-500" />
        </Button>
      )}
    </div>
  );
};

export default BackToTopButton;
